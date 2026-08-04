import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const statusBadge = (s) => ({
  PLANNED: <Badge color="amber">Planned</Badge>,
  IN_PROGRESS: <Badge color="sky">In Progress</Badge>,
  COMPLETED: <Badge color="green">Completed</Badge>,
  CANCELLED: <Badge color="red">Cancelled</Badge>,
}[s] || s);

export default function Production({ createReq }) {
  const [orders, setOrders] = useState(null);
  const [items, setItems] = useState([]);
  const [boms, setBoms] = useState([]);
  const [filter, setFilter] = useState({ status: '' });
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ output_item_id: '', planned_qty: 1, remarks: '' });
  const [preview, setPreview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [completeForm, setCompleteForm] = useState(null);
  const [bomInfo, setBomInfo] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setOrders(await api('/production' + qs(filter))); }
    catch (e) { toast(e.message, 'error'); setOrders([]); }
  };
  useEffect(() => { load(); }, [filter.status]);

  useEffect(() => {
    if (createReq && createReq.page === 'production') setCreateModal(true);
  }, [createReq]);

  useEffect(() => {
    Promise.all([api('/items'), api('/bom')])
      .then(([it, bm]) => { setItems(it); setBoms(bm); })
      .catch(e => toast(e.message, 'error'));
  }, []);

  const bomableIds = new Set(boms.filter(b => b.is_active).map(b => b.output_item_id));
  const bomable = items.filter(i => bomableIds.has(i.item_id));

  const loadPreview = async (output_item_id, qty) => {
    if (!output_item_id || !(Number(qty) > 0)) { setPreview(null); return; }
    try { setPreview(await api(`/bom/explode?output_item_id=${output_item_id}&qty=${qty}`)); }
    catch (e) { toast(e.message, 'error'); setPreview(null); }
  };

  const createOrder = async () => {
    if (!createForm.output_item_id || !(Number(createForm.planned_qty) > 0)) { toast('Select item and qty', 'error'); return; }
    setBusy(true);
    try {
      const o = await api('/production', { method: 'POST', body: createForm });
      toast(`Order ${o.order_no} created`);
      setCreateModal(false); setPreview(null); setCreateForm({ output_item_id: '', planned_qty: 1, remarks: '' });
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (row) => {
    try { setDetail(await api(`/production/${row.prod_order_id}`)); }
    catch (e) { toast(e.message, 'error'); }
  };

  const checkStock = async () => {
    if (!detail) return;
    try {
      const r = await api(`/production/${detail.prod_order_id}/check-stock`, { method: 'POST' });
      toast(r.hasShortfall ? 'Shortfall found — see requirement list' : 'All raw materials available ✅', r.hasShortfall ? 'info' : 'success');
      setDetail(d => ({ ...d, requirements: r.requirements }));
    } catch (e) { toast(e.message, 'error'); }
  };

  const openComplete = async () => {
    if (!detail) return;
    try {
      const bom = await api(`/bom/${detail.bom_id}`);
      setBomInfo(bom);
      const qty = detail.planned_qty;
      const est = await api(`/bom/explode?output_item_id=${detail.output_item_id}&qty=${qty}`);
      setCompleteForm({
        completed_qty: qty,
        labor_cost: bom.labor_cost,
        overhead_pct: bom.overhead_pct,
        consumptions: est.requirements.map(r => ({ item_id: r.item_id, sku: r.sku, item_name: r.item_name, unit: r.unit, qty: r.qty })),
        scrap: [{ item_id: '', qty: '', rate: '' }],
      });
    } catch (e) { toast(e.message, 'error'); }
  };

  const complete = async () => {
    if (!(Number(completeForm.completed_qty) > 0)) { toast('Completed qty must be > 0', 'error'); return; }
    setBusy(true);
    try {
      const body = {
        completed_qty: Number(completeForm.completed_qty),
        actual_labor_cost: Number(completeForm.labor_cost),
        overhead_pct: Number(completeForm.overhead_pct),
        consumptions: completeForm.consumptions.map(c => ({ item_id: c.item_id, qty_actual: Number(c.qty) })),
        scrap: completeForm.scrap.filter(s => s.item_id && Number(s.qty) > 0).map(s => ({ item_id: Number(s.item_id), qty: Number(s.qty), rate: Number(s.rate) || 0 })),
        remarks: completeForm.remarks,
      };
      const r = await api(`/production/${detail.prod_order_id}/complete`, { method: 'POST', body });
      toast(`Production completed: ${r.completedQty} pcs, actual cost ${inr(r.actualCost)}`);
      setCompleteForm(null); setDetail(null); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const cancelOrder = async () => {
    try {
      await api(`/production/${cancelTarget.prod_order_id}/cancel`, { method: 'POST', body: { remarks: 'Cancelled from UI' } });
      toast('Order cancelled'); setCancelTarget(null); setDetail(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const scrapItems = items.filter(i => i.item_type === 'SCRAP');

  if (!orders) return <Spinner label="Loading production orders..." />;

  return (
    <div>
      <PageHeader title="Production Orders"
        subtitle="Plan production from BOM, check stock, complete with actual consumption and scrap"
        actions={<Button variant="primary" onClick={() => setCreateModal(true)}>+ New Production Order</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex gap-2">
          <Select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-56">
            <option value="">All Status</option>
            <option value="PLANNED">Planned</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          keyField="prod_order_id"
          rows={orders}
          onRowClick={openDetail}
          columns={[
            { key: 'order_no', label: 'Order No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.order_no}</span> },
            { key: 'output_name', label: 'Item', render: r => <span className="font-medium text-slate-800">{r.output_name}</span> },
            { key: 'bom_version', label: 'BOM', align: 'center', render: r => `v${r.bom_version}` },
            { key: 'planned_qty', label: 'Planned', align: 'right', render: r => `${fmt(r.planned_qty)} ${r.output_unit}` },
            { key: 'completed_qty', label: 'Completed', align: 'right', render: r => r.completed_qty > 0 ? `${fmt(r.completed_qty)}` : '—' },
            { key: 'status', label: 'Status', align: 'center', render: r => statusBadge(r.status) },
            { key: 'estimated_cost', label: 'Est. Cost', align: 'right', render: r => inr(r.estimated_cost) },
            { key: 'actual_cost', label: 'Actual Cost', align: 'right', render: r => r.actual_cost > 0 ? inr(r.actual_cost) : '—' },
            { key: 'order_date', label: 'Date', render: r => fmtDate(r.order_date) },
            { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
              <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                {r.status === 'PLANNED' && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
                <Button variant="ghost" onClick={() => openDetail(r)}>Details</Button>
              </div>
            ) },
          ]}
        />
      </Card>

      {/* Create order */}
      {createModal && (
        <Modal title="New Production Order" onClose={() => setCreateModal(false)} wide
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={createOrder} disabled={busy}>{busy ? 'Creating...' : 'Create Order'}</Button>
          </>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Select label="Output Item * (must have active BOM)" value={createForm.output_item_id} className="md:col-span-2"
              onChange={e => { setCreateForm(f => ({ ...f, output_item_id: e.target.value })); loadPreview(e.target.value, createForm.planned_qty); }}>
              <option value="">Select...</option>
              {bomable.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name}</option>)}
            </Select>
            <Input label="Qty to Produce *" type="number" step="any" min="1" value={createForm.planned_qty}
              onChange={e => { setCreateForm(f => ({ ...f, planned_qty: e.target.value })); loadPreview(createForm.output_item_id, e.target.value); }} />
            <Input label="Remarks" value={createForm.remarks} onChange={e => setCreateForm(f => ({ ...f, remarks: e.target.value }))} className="md:col-span-3" />
          </div>

          {preview && (
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-bold text-slate-700">Required Raw Materials</h4>
                <span className="text-sm font-bold text-indigo-700">Est. Cost: {inr(preview.total)}</span>
              </div>
              <DataTable
                keyField="item_id"
                rows={preview.requirements}
                dense
                columns={[
                  { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
                  { key: 'item_name', label: 'Name', render: r => <span className="text-slate-700">{r.item_name}</span> },
                  { key: 'qty', label: 'Req Qty', align: 'right', render: r => `${fmt(r.qty)} ${r.unit}` },
                  { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
                  { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
                  { key: 'available', label: 'Available', align: 'right', render: r => fmt(r.available) },
                  { key: 'shortfall', label: 'Shortfall', align: 'right', render: r => r.shortfall > 0 ? <span className="text-rose-600 font-semibold">{fmt(r.shortfall)}</span> : '—' },
                ]}
              />
            </div>
          )}
        </Modal>
      )}

      {/* Detail */}
      {detail && (
        <Modal title={`Order ${detail.order_no}`} onClose={() => setDetail(null)} wide
          footer={<>
            {detail.status === 'PLANNED' && <>
              <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel Order</Button>
              <Button onClick={checkStock}>Check Stock Availability</Button>
              <Button variant="success" onClick={openComplete}>Complete Production</Button>
            </>}
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
            <div><div className="text-[11px] text-slate-500">Item</div><div className="font-semibold">{detail.output_name} <span className="text-slate-400">({detail.output_sku})</span></div></div>
            <div><div className="text-[11px] text-slate-500">Status</div><div>{statusBadge(detail.status)}</div></div>
            <div><div className="text-[11px] text-slate-500">Planned / Completed</div><div className="font-semibold">{fmt(detail.planned_qty)} / {fmt(detail.completed_qty)} {detail.output_unit}</div></div>
            <div><div className="text-[11px] text-slate-500">BOM Version</div><div className="font-semibold">v{detail.bom_version}</div></div>
            <div><div className="text-[11px] text-slate-500">Est. Cost</div><div className="font-semibold">{inr(detail.estimated_cost)}</div></div>
            <div><div className="text-[11px] text-slate-500">Actual Cost</div><div className={cxText(detail)}>{detail.actual_cost > 0 ? inr(detail.actual_cost) : '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Order Date</div><div>{fmtDate(detail.order_date)}</div></div>
            <div><div className="text-[11px] text-slate-500">Completed Date</div><div>{detail.completed_date ? fmtDate(detail.completed_date) : '—'}</div></div>
          </div>

          {detail.status === 'PLANNED' && (
            <div className="mb-4 bg-slate-50 rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between mb-2">
                <h4 className="text-sm font-bold text-slate-700">Raw Material Requirement</h4>
                <Button variant="ghost" onClick={checkStock}>Check Stock Availability</Button>
              </div>
              <DataTable
                keyField="item_id"
                rows={detail.requirements || []}
                dense
                emptyText="Click 'Check Stock Availability' to load requirements"
                columns={[
                  { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
                  { key: 'item_name', label: 'Name' },
                  { key: 'qty', label: 'Req Qty', align: 'right', render: r => `${fmt(r.qty)} ${r.unit}` },
                  { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
                  { key: 'available', label: 'Available', align: 'right', render: r => fmt(r.available) },
                  { key: 'shortfall', label: 'Shortfall', align: 'right', render: r => r.shortfall > 0 ? <span className="text-rose-600 font-semibold">{fmt(r.shortfall)}</span> : <span className="text-emerald-600">✓</span> },
                ]}
              />
            </div>
          )}

          {detail.status === 'COMPLETED' && (
            <>
              <h4 className="text-sm font-bold text-slate-700 mb-2">Consumption</h4>
              <DataTable
                keyField="consumption_id"
                rows={detail.consumption}
                dense
                columns={[
                  { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
                  { key: 'item_name', label: 'Name' },
                  { key: 'qty_planned', label: 'Planned', align: 'right', render: r => `${fmt(r.qty_planned)} ${r.unit}` },
                  { key: 'qty_actual', label: 'Actual', align: 'right', render: r => <span className="font-semibold">{fmt(r.qty_actual)}</span> },
                  { key: 'rate_at_consumption', label: 'Rate', align: 'right', render: r => inr(r.rate_at_consumption) },
                  { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
                ]}
              />
              {detail.scrap.length > 0 && (
                <>
                  <h4 className="text-sm font-bold text-slate-700 mt-4 mb-2">Scrap Generated</h4>
                  <DataTable
                    keyField="scrap_id"
                    rows={detail.scrap}
                    dense
                    columns={[
                      { key: 'sku', label: 'Scrap Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
                      { key: 'qty', label: 'Qty', align: 'right', render: r => `${fmt(r.qty)} ${r.unit}` },
                      { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
                      { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
                    ]}
                  />
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {/* Complete form */}
      {completeForm && detail && (
        <Modal title={`Complete Production — ${detail.order_no}`} onClose={() => setCompleteForm(null)} wide
          footer={<>
            <Button onClick={() => setCompleteForm(null)}>Cancel</Button>
            <Button variant="success" onClick={complete} disabled={busy}>{busy ? 'Completing...' : 'Complete Production'}</Button>
          </>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Input label="Completed Qty *" type="number" step="any" min="0"
              value={completeForm.completed_qty} onChange={e => setCompleteForm(f => ({ ...f, completed_qty: e.target.value }))} />
            <Input label="Actual Labor Cost (₹)" type="number" step="any" value={completeForm.labor_cost} onChange={e => setCompleteForm(f => ({ ...f, labor_cost: e.target.value }))} />
            <Input label="Overhead %" type="number" step="any" value={completeForm.overhead_pct} onChange={e => setCompleteForm(f => ({ ...f, overhead_pct: e.target.value }))} />
          </div>

          <h4 className="text-sm font-bold text-slate-700 mb-2">Actual Consumption (edit if actual wastage differs)</h4>
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg mb-4">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead><tr className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                <th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Planned</th><th className="text-right px-3 py-2">Actual</th><th className="text-right px-3 py-2">Unit</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {completeForm.consumptions.map((c, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5"><span className="font-mono text-xs text-indigo-700">{c.sku}</span> <span className="text-slate-500">{c.item_name}</span></td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{fmt(c.qty)}</td>
                    <td className="px-3 py-1.5">
                      <input type="number" step="any" className="w-24 text-right rounded border border-slate-300 px-2 py-1 text-sm"
                        value={c.qty}
                        onChange={e => setCompleteForm(f => ({ ...f, consumptions: f.consumptions.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x) }))} />
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{c.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-700">Scrap / Wastage Generated</h4>
            <Button variant="ghost" onClick={() => setCompleteForm(f => ({ ...f, scrap: [...f.scrap, { item_id: '', qty: '', rate: '' }] }))}>+ Add Scrap Line</Button>
          </div>
          {completeForm.scrap.map((s, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2 bg-slate-50 rounded-lg p-2">
              <Select value={s.item_id} className="col-span-5"
                onChange={e => setCompleteForm(f => ({ ...f, scrap: f.scrap.map((x, xi) => xi === i ? { ...x, item_id: e.target.value } : x) }))}>
                <option value="">Scrap item...</option>
                {scrapItems.map(it => <option key={it.item_id} value={it.item_id}>{it.sku} — {it.item_name}</option>)}
              </Select>
              <Input type="number" step="any" placeholder="Qty" value={s.qty} className="col-span-2"
                onChange={e => setCompleteForm(f => ({ ...f, scrap: f.scrap.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x) }))} />
              <Input type="number" step="any" placeholder="Rate ₹" value={s.rate} className="col-span-3"
                onChange={e => setCompleteForm(f => ({ ...f, scrap: f.scrap.map((x, xi) => xi === i ? { ...x, rate: e.target.value } : x) }))} />
              <button className="col-span-2 text-rose-500 hover:text-rose-700 text-lg cursor-pointer"
                onClick={() => setCompleteForm(f => ({ ...f, scrap: f.scrap.filter((_, xi) => xi !== i) }))}>×</button>
            </div>
          ))}
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Production Order" message={`Cancel ${cancelTarget.order_no}? No stock has been consumed for this order.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelOrder} />
      )}
    </div>
  );
}

function cxText(d) {
  if (!d.actual_cost) return 'text-slate-400';
  const est = d.estimated_cost * (d.planned_qty ? d.completed_qty / d.planned_qty : 1);
  return d.actual_cost > est ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold';
}
