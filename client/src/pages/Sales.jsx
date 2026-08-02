import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export default function Sales() {
  const [invoices, setInvoices] = useState(null);
  const [items, setItems] = useState([]);
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ customer_name: '', invoice_date: '', remarks: '', lines: [{ item_id: '', qty: 1, rate: 0, gst_pct: 18 }] });
  const [detail, setDetail] = useState(null);
  const [returnForm, setReturnForm] = useState({ line_id: '', qty: '', remarks: '' });
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setInvoices(await api('/sales')); }
    catch (e) { toast(e.message, 'error'); setInvoices([]); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    api('/items').then(setItems).catch(e => toast(e.message, 'error'));
  }, []);

  const sellable = items.filter(i => i.item_type === 'FINISHED_GOOD' || i.item_type === 'SCRAP');

  const createInvoice = async () => {
    const cleanLines = form.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (!form.customer_name.trim()) { toast('Customer name required', 'error'); return; }
    if (cleanLines.length === 0) { toast('Add at least one item line', 'error'); return; }
    setBusy(true);
    try {
      const inv = await api('/sales', { method: 'POST', body: { ...form, lines: cleanLines.map(l => ({ item_id: Number(l.item_id), qty: Number(l.qty), rate: Number(l.rate), gst_pct: Number(l.gst_pct) })) } });
      toast(`Invoice ${inv.invoice_no} posted — stock updated`);
      setCreateModal(false);
      setForm({ customer_name: '', invoice_date: '', remarks: '', lines: [{ item_id: '', qty: 1, rate: 0, gst_pct: 18 }] });
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (row) => {
    try { setDetail(await api(`/sales/${row.invoice_id}`)); setReturnForm({ line_id: '', qty: '', remarks: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };

  const recordReturn = async () => {
    if (!returnForm.line_id || !(Number(returnForm.qty) > 0)) { toast('Select line and qty', 'error'); return; }
    try {
      await api(`/sales/${detail.invoice_id}/return`, { method: 'POST', body: { ...returnForm, qty: Number(returnForm.qty) } });
      toast('Sales return posted — stock IN');
      setReturnForm({ line_id: '', qty: '', remarks: '' });
      setDetail(await api(`/sales/${detail.invoice_id}`));
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const cancelInvoice = async () => {
    try {
      await api(`/sales/${cancelTarget.invoice_id}/cancel`, { method: 'POST' });
      toast('Invoice cancelled — stock reversed'); setCancelTarget(null); setDetail(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const totals = form.lines.reduce((t, l) => {
    const qty = Number(l.qty) || 0, rate = Number(l.rate) || 0, gst = Number(l.gst_pct) || 0;
    return { taxable: t.taxable + qty * rate, gst: t.gst + qty * rate * gst / 100 };
  }, { taxable: 0, gst: 0 });

  if (!invoices) return <Spinner label="Loading invoices..." />;

  return (
    <div>
      <PageHeader title="Sales / बिक्री" subtitle="Invoices (stock OUT) and sales returns (stock IN)"
        actions={<Button variant="primary" onClick={() => setCreateModal(true)}>+ New Invoice</Button>} />

      <Card pad={false}>
        <DataTable
          keyField="invoice_id"
          rows={invoices}
          onRowClick={openDetail}
          columns={[
            { key: 'invoice_no', label: 'Invoice No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.invoice_no}</span> },
            { key: 'customer_name', label: 'Customer', render: r => <span className="font-medium text-slate-800">{r.customer_name}</span> },
            { key: 'invoice_date', label: 'Date', render: r => fmtDate(r.invoice_date) },
            { key: 'total_qty', label: 'Qty', align: 'right' },
            { key: 'invoice_total', label: 'Invoice Total', align: 'right', render: r => <span className="font-bold text-slate-800">{inr(r.invoice_total)}</span> },
            { key: 'status', label: 'Status', align: 'center', render: r => r.status === 'POSTED' ? <Badge color="green">Posted</Badge> : <Badge color="red">Cancelled</Badge> },
            { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
              <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                {r.status === 'POSTED' && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
                <Button variant="ghost" onClick={() => openDetail(r)}>Details / Return</Button>
              </div>
            ) },
          ]}
        />
      </Card>

      {createModal && (
        <Modal title="New Sales Invoice / नया इनवॉइस" onClose={() => setCreateModal(false)} wide
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={createInvoice} disabled={busy}>{busy ? 'Posting...' : 'Post Invoice'}</Button>
          </>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Input label="Customer Name * / ग्राहक" value={form.customer_name} autoFocus onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} />
            <Input label="Invoice Date" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
            <Input label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>

          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-slate-700">Items / मद</h4>
            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { item_id: '', qty: 1, rate: 0, gst_pct: 18 }] }))}>+ Add Line</Button>
          </div>
          {form.lines.map((line, i) => {
            const it = items.find(x => x.item_id === Number(line.item_id));
            const lineTotal = (Number(line.qty) || 0) * (Number(line.rate) || 0);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2 bg-slate-50 rounded-lg p-2">
                <Select value={line.item_id} className="col-span-4"
                  onChange={e => {
                    const it2 = items.find(x => x.item_id === Number(e.target.value));
                    setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, item_id: e.target.value, rate: it2?.sale_rate || x.rate } : x) }));
                  }}>
                  <option value="">Finished item...</option>
                  {sellable.map(x => <option key={x.item_id} value={x.item_id}>{x.sku} — {x.item_name}</option>)}
                </Select>
                <Input type="number" step="any" min="0" placeholder="Qty" value={line.qty} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x) }))} />
                <Input type="number" step="any" min="0" placeholder="Rate ₹" value={line.rate} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, rate: e.target.value } : x) }))} />
                <Select value={line.gst_pct} className="col-span-2"
                  onChange={e => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, gst_pct: e.target.value } : x) }))}>
                  {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                </Select>
                <div className="col-span-2 text-right text-xs text-slate-500">
                  {it && <>{fmt(it.current_stock_qty)} in stock<div className="font-medium text-slate-700">{inr(lineTotal)}</div></>}
                </div>
                <button className="col-span-12 md:col-span-1 text-rose-500 hover:text-rose-700 text-lg cursor-pointer"
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
        <Modal title={`Invoice ${detail.invoice_no} — ${detail.customer_name}`} onClose={() => setDetail(null)} wide
          footer={<>
            {detail.status === 'POSTED' && <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel Invoice</Button>}
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            <div><div className="text-[11px] text-slate-500">Invoice Total</div><div className="font-bold">{inr(detail.total_value)}</div></div>
            <div><div className="text-[11px] text-slate-500">COGS</div><div>{inr(detail.cogs_value)}</div></div>
            <div><div className="text-[11px] text-slate-500">Gross Profit</div><div className={detail.gross_profit >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{inr(detail.gross_profit)}</div></div>
            <div><div className="text-[11px] text-slate-500">Status</div><div>{detail.status === 'POSTED' ? <Badge color="green">Posted</Badge> : <Badge color="red">Cancelled</Badge>}</div></div>
          </div>

          <h4 className="text-sm font-bold text-slate-700 mb-2">Lines</h4>
          <DataTable
            keyField="line_id"
            rows={detail.lines}
            dense
            columns={[
              { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
              { key: 'item_name', label: 'Name' },
              { key: 'qty', label: 'Qty', align: 'right', render: r => `${fmt(r.qty)} ${r.unit}` },
              { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
              { key: 'gst_pct', label: 'GST %', align: 'right' },
              { key: 'value', label: 'Value', align: 'right', render: r => <span className="font-semibold">{inr((r.qty - r.qty_returned) * r.rate)}</span> },
              { key: 'qty_returned', label: 'Returned', align: 'right', render: r => r.qty_returned > 0 ? <span className="text-amber-600 font-semibold">{fmt(r.qty_returned)}</span> : '—' },
            ]}
          />

          {detail.status === 'POSTED' && (
            <>
              <h4 className="text-sm font-bold text-slate-700 mt-4 mb-2">Record Sales Return / वापसी दर्ज करें</h4>
              <div className="grid grid-cols-12 gap-2 bg-slate-50 rounded-lg p-2 items-center">
                <Select value={returnForm.line_id} className="col-span-6"
                  onChange={e => setReturnForm(f => ({ ...f, line_id: e.target.value }))}>
                  <option value="">Select line to return...</option>
                  {detail.lines.filter(l => l.qty_returned < l.qty).map(l => (
                    <option key={l.line_id} value={l.line_id}>{l.sku} — remaining {fmt(l.qty - l.qty_returned)}</option>
                  ))}
                </Select>
                <Input type="number" step="any" min="0" placeholder="Return qty" value={returnForm.qty} className="col-span-2"
                  onChange={e => setReturnForm(f => ({ ...f, qty: e.target.value }))} />
                <Input placeholder="Remarks" value={returnForm.remarks} className="col-span-3"
                  onChange={e => setReturnForm(f => ({ ...f, remarks: e.target.value }))} />
                <Button variant="success" onClick={recordReturn} className="col-span-1">Post</Button>
              </div>
            </>
          )}

          {detail.returns.length > 0 && (
            <>
              <h4 className="text-sm font-bold text-slate-700 mt-4 mb-2">Returns History</h4>
              <DataTable
                keyField="return_id"
                rows={detail.returns}
                dense
                columns={[
                  { key: 'return_date', label: 'Date', render: r => fmtDate(r.return_date) },
                  { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
                  { key: 'qty', label: 'Qty', align: 'right', render: r => `${fmt(r.qty)} ${r.unit}` },
                  { key: 'remarks', label: 'Remarks' },
                ]}
              />
            </>
          )}
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Invoice" message={`Cancel ${cancelTarget.invoice_no}? Sold stock will be reversed back into inventory.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelInvoice} />
      )}
    </div>
  );
}
