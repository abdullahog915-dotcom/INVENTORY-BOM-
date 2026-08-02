import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const poStatus = (s) => ({
  PENDING: <Badge color="amber">Pending</Badge>,
  PARTIAL: <Badge color="sky">Partial</Badge>,
  RECEIVED: <Badge color="green">Received</Badge>,
  CANCELLED: <Badge color="red">Cancelled</Badge>,
}[s] || s);

export default function Purchase() {
  const [pos, setPos] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({ status: '' });
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', po_date: '', remarks: '', lines: [{ item_id: '', qty_ordered: 1, rate: 0, gst_pct: 18 }] });
  const [detail, setDetail] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setPos(await api('/purchase' + qs(filter))); }
    catch (e) { toast(e.message, 'error'); setPos([]); }
  };
  useEffect(() => { load(); }, [filter.status]);

  useEffect(() => {
    Promise.all([api('/vendors'), api('/items')])
      .then(([v, it]) => { setVendors(v); setItems(it); })
      .catch(e => toast(e.message, 'error'));
  }, []);

  const createPO = async () => {
    const cleanLines = form.lines.filter(l => l.item_id && Number(l.qty_ordered) > 0);
    if (!form.vendor_id) { toast('Select vendor', 'error'); return; }
    if (cleanLines.length === 0) { toast('Add at least one item line', 'error'); return; }
    setBusy(true);
    try {
      const po = await api('/purchase', { method: 'POST', body: { ...form, lines: cleanLines.map(l => ({ item_id: Number(l.item_id), qty_ordered: Number(l.qty_ordered), rate: Number(l.rate), gst_pct: Number(l.gst_pct) })) } });
      toast(`PO ${po.po_no} created`);
      setCreateModal(false);
      setForm({ vendor_id: '', po_date: '', remarks: '', lines: [{ item_id: '', qty_ordered: 1, rate: 0, gst_pct: 18 }] });
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (row) => {
    try { setDetail(await api(`/purchase/${row.po_id}`)); }
    catch (e) { toast(e.message, 'error'); }
  };

  const receive = async () => {
    if (!detail) return;
    const lines = detail.lines
      .map(l => ({ line_id: l.po_line_id, qty_received: Number(l.__receive || 0) }))
      .filter(l => l.qty_received > 0);
    if (lines.length === 0) { toast('Enter receive qty in at least one line', 'error'); return; }
    setBusy(true);
    try {
      await api(`/purchase/${detail.po_id}/receive`, { method: 'POST', body: { lines, receive_date: detail.receive_date || new Date().toISOString().slice(0, 10) + ' 12:00:00' } });
      toast('Purchase entry posted — stock updated');
      setDetail(await api(`/purchase/${detail.po_id}`));
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const cancelPO = async () => {
    try {
      await api(`/purchase/${cancelTarget.po_id}/cancel`, { method: 'POST' });
      toast('PO cancelled'); setCancelTarget(null); setDetail(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const totals = form.lines.reduce((t, l) => {
    const qty = Number(l.qty_ordered) || 0, rate = Number(l.rate) || 0, gst = Number(l.gst_pct) || 0;
    return { taxable: t.taxable + qty * rate, gst: t.gst + qty * rate * gst / 100 };
  }, { taxable: 0, gst: 0 });

  if (!pos) return <Spinner label="Loading purchase orders..." />;

  return (
    <div>
      <PageHeader title="Purchase / खरीद" subtitle="Purchase orders and purchase entries (stock IN)"
        actions={<Button variant="primary" onClick={() => setCreateModal(true)}>+ New Purchase Order</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex gap-2">
          <Select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-56">
            <option value="">All Status</option>
            <option value="PENDING">Pending / लंबित</option>
            <option value="PARTIAL">Partial</option>
            <option value="RECEIVED">Received / प्राप्त</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          keyField="po_id"
          rows={pos}
          onRowClick={openDetail}
          columns={[
            { key: 'po_no', label: 'PO No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.po_no}</span> },
            { key: 'vendor_name', label: 'Vendor', render: r => <span className="font-medium text-slate-800">{r.vendor_name || '—'}</span> },
            { key: 'po_date', label: 'Date', render: r => fmtDate(r.po_date) },
            { key: 'line_count', label: 'Lines', align: 'right' },
            { key: 'qty_pending', label: 'Pending Qty', align: 'right', render: r => r.qty_pending > 0 ? <span className="text-amber-600 font-semibold">{fmt(r.qty_pending)}</span> : <span className="text-emerald-600">—</span> },
            { key: 'status', label: 'Status', align: 'center', render: r => poStatus(r.status) },
            { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
              <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                {r.status !== 'RECEIVED' && r.status !== 'CANCELLED' && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
                <Button variant="ghost" onClick={() => openDetail(r)}>Receive / Details</Button>
              </div>
            ) },
          ]}
        />
      </Card>

      {createModal && (
        <Modal title="New Purchase Order / नया पीओ" onClose={() => setCreateModal(false)} wide
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={createPO} disabled={busy}>{busy ? 'Creating...' : 'Create PO'}</Button>
          </>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Select label="Vendor * / विक्रेता" value={form.vendor_id}
              onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
            </Select>
            <Input label="PO Date" type="date" value={form.po_date} onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))} />
            <Input label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>

          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-slate-700">Items / मद</h4>
            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { item_id: '', qty_ordered: 1, rate: 0, gst_pct: 18 }] }))}>+ Add Line</Button>
          </div>
          {form.lines.map((line, i) => {
            const it = items.find(x => x.item_id === Number(line.item_id));
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2 bg-slate-50 rounded-lg p-2">
                <Select value={line.item_id} className="col-span-5"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, item_id: e.target.value } : x) }))}>
                  <option value="">Raw material...</option>
                  {items.filter(x => x.item_type === 'RAW_MATERIAL').map(x => <option key={x.item_id} value={x.item_id}>{x.sku} — {x.item_name}</option>)}
                </Select>
                <Input type="number" step="any" min="0" placeholder="Qty" value={line.qty_ordered} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, qty_ordered: e.target.value } : x) }))} />
                <Input type="number" step="any" min="0" placeholder="Rate ₹" value={line.rate} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, rate: e.target.value } : x) }))} />
                <Select value={line.gst_pct} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, gst_pct: e.target.value } : x) }))}>
                  {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                </Select>
                <button className="col-span-1 text-rose-500 hover:text-rose-700 text-lg cursor-pointer"
                  onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, xi) => xi !== i) }))}>×</button>
              </div>
            );
          })}
          <div className="mt-3 text-right text-sm text-slate-600 bg-indigo-50 rounded-lg p-3">
            Taxable: <b>{inr(totals.taxable)}</b> &nbsp;|&nbsp; GST: <b>{inr(totals.gst)}</b> &nbsp;|&nbsp; Total: <b className="text-indigo-700">{inr(totals.taxable + totals.gst)}</b>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`PO ${detail.po_no} — ${detail.vendor_name || ''}`} onClose={() => setDetail(null)} wide
          footer={<>
            {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && <>
              <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel PO</Button>
              <Button variant="success" onClick={receive} disabled={busy}>{busy ? 'Posting...' : 'Post Purchase Entry'}</Button>
            </>}
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            <div><div className="text-[11px] text-slate-500">Vendor</div><div className="font-semibold">{detail.vendor_name || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">GSTIN</div><div className="font-mono text-xs">{detail.gstin || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Status</div><div>{poStatus(detail.status)}</div></div>
            <div><div className="text-[11px] text-slate-500">Total (with GST)</div><div className="font-bold">{inr(detail.total_value)}</div></div>
          </div>

          <h4 className="text-sm font-bold text-slate-700 mb-2">Lines / मद</h4>
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">GST %</th>
                <th className="text-right px-3 py-2">Received</th>
                <th className="text-right px-3 py-2">Pending</th>
                {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && <th className="text-right px-3 py-2">Receive Now</th>}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {detail.lines.map(l => (
                  <tr key={l.po_line_id}>
                    <td className="px-3 py-2"><span className="font-mono text-xs text-indigo-700">{l.sku}</span> <span className="text-slate-500">{l.item_name}</span></td>
                    <td className="px-3 py-2 text-right">{fmt(l.qty_ordered)} {l.unit}</td>
                    <td className="px-3 py-2 text-right">{inr(l.rate)}</td>
                    <td className="px-3 py-2 text-right">{l.gst_pct}%</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmt(l.qty_received)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmt(Math.max(0, l.qty_ordered - l.qty_received))}</td>
                    {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && (
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="any" min="0" max={Math.max(0, l.qty_ordered - l.qty_received)} placeholder="0"
                          className="w-24 text-right rounded border border-slate-300 px-2 py-1 text-sm"
                          value={l.__receive || ''}
                          onChange={e => setDetail(d => ({ ...d, lines: d.lines.map((x) => x.po_line_id === l.po_line_id ? { ...x, __receive: e.target.value } : x) }))} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Purchase Order" message={`Cancel ${cancelTarget.po_no}? Stock already received (if any) stays in inventory.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelPO} />
      )}
    </div>
  );
}
