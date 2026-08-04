import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate, amountInWords, isSameState } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES, PAYMENT_TERMS } from '../constants.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function computeLine(l, same) {
  const qty = Number(l.qty) || 0, rate = Number(l.rate) || 0;
  const gross = qty * rate;
  const discount = gross * (Number(l.discount_pct) || 0) / 100;
  const taxable = gross - discount;
  const gst = Number(l.gst_pct) || 0;
  let cgst = 0, sgst = 0, igst = 0;
  if (same) { cgst = taxable * gst / 200; sgst = taxable * gst / 200; }
  else { igst = taxable * gst / 100; }
  const line_total = taxable + cgst + sgst + igst;
  return { taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), line_total: round2(line_total) };
}

const statusBadge = (s) => ({
  DRAFT: <Badge color="slate">Draft</Badge>,
  SENT: <Badge color="sky">Sent</Badge>,
  PAID: <Badge color="green">Paid</Badge>,
  OVERDUE: <Badge color="red">Overdue</Badge>,
  CANCELLED: <Badge color="red">Cancelled</Badge>,
}[s] || s);

const emptyLine = () => ({ item_id: '', qty: 1, rate: 0, discount_pct: 0, gst_pct: 18 });
const emptyForm = () => ({
  customer_id: '', customer_name: '', customer_gstin: '', customer_state: '', billing_address: '', shipping_address: '',
  place_of_supply: '', invoice_date: new Date().toISOString().slice(0, 10), due_date: '', payment_terms: '',
  po_reference: '', terms_conditions: '', notes: '', authorized_signatory: '', invoice_no: '',
  lines: [emptyLine()],
});
const emptyNewCustomer = () => ({ customer_name: '', contact_no: '', gstin: '', state: '', billing_address: '', shipping_address: '' });

export default function Sales() {
  const { current: company } = useCompany();
  const [inv, setInv] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({ status: '', search: '' });
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState(emptyNewCustomer());
  const [editingId, setEditingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [returnTarget, setReturnTarget] = useState(null);
  const [printing, setPrinting] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setInv(await api('/sales' + qs(filter))); }
    catch (e) { toast(e.message, 'error'); setInv([]); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [filter.status, filter.search]);

  useEffect(() => {
    Promise.all([api('/customers'), api('/items')])
      .then(([c, it]) => { setCustomers(c); setItems(it); })
      .catch(e => toast(e.message, 'error'));
  }, []);

  const openNew = async () => {
    setEditingId(null);
    setForm(emptyForm());
    try {
      const { next_no } = await api('/sales/next-no');
      setForm(f => ({ ...f, invoice_no: next_no }));
    } catch { /* auto server-side */ }
    setCreateModal(true);
  };

  const openEdit = async (row) => {
    try {
      const d = await api(`/sales/${row.invoice_id}`);
      setEditingId(d.invoice_id);
      setDetail(null);
      const matched = (customers || []).find(c =>
        String(c.customer_name || '').trim().toLowerCase() === String(d.customer_name || '').trim().toLowerCase());
      setForm({
        invoice_no: d.invoice_no || '',
        invoice_date: d.invoice_date ? String(d.invoice_date).slice(0, 10) : '',
        due_date: d.due_date ? String(d.due_date).slice(0, 10) : '',
        payment_terms: d.payment_terms || '',
        po_reference: d.po_reference || '',
        place_of_supply: d.place_of_supply || '',
        authorized_signatory: d.authorized_signatory || '',
        customer_id: matched ? matched.customer_id : '',
        customer_name: d.customer_name || '',
        customer_gstin: d.customer_gstin || '',
        customer_state: d.customer_state || '',
        billing_address: d.billing_address || '',
        shipping_address: d.shipping_address || '',
        terms_conditions: d.terms_conditions || '',
        notes: d.notes || '',
        lines: (d.lines || []).map(l => ({
          item_id: String(l.item_id), qty: l.qty, rate: l.rate,
          discount_pct: l.discount_pct, gst_pct: l.gst_pct,
        })),
      });
      setCreateModal(true);
    } catch (e) { toast(e.message, 'error'); }
  };

  const openDetail = async (row) => {
    try { setDetail(await api(`/sales/${row.invoice_id}`)); }
    catch (e) { toast(e.message, 'error'); }
  };

  /* ---- live form totals (client preview; server computes authoritative) ---- */
  const same = isSameState(form.customer_state, company?.state);
  const live = useMemo(() => {
    const acc = form.lines.map(l => computeLine(l, same));
    const t = acc.reduce((a, x) => ({
      taxable: a.taxable + x.taxable, cgst: a.cgst + x.cgst, sgst: a.sgst + x.sgst,
      igst: a.igst + x.igst, line_total: a.line_total + x.line_total,
    }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, line_total: 0 });
    return { ...t, taxable: round2(t.taxable), cgst: round2(t.cgst), sgst: round2(t.sgst), igst: round2(t.igst), line_total: round2(t.line_total) };
  }, [form.lines, same]);

  const pickCustomer = (id) => {
    const c = customers.find(x => x.customer_id === Number(id));
    if (!c) return;
    setForm(f => ({ ...f, customer_id: c.customer_id, customer_name: c.customer_name, customer_gstin: c.gstin || '', customer_state: c.state || '',
      billing_address: c.billing_address || '', shipping_address: c.shipping_address || '', place_of_supply: c.state || '' }));
  };

  /* Create a brand-new customer from the inline form, then select it in the
     invoice without losing any other fields already filled in. */
  const createInlineCustomer = async () => {
    if (!newCustomerForm.customer_name.trim()) { toast('Customer name required', 'error'); return; }
    setBusy(true);
    try {
      const c = await api('/customers', { method: 'POST', body: {
        customer_name: newCustomerForm.customer_name.trim(),
        contact_no: newCustomerForm.contact_no.trim() || '',
        gstin: newCustomerForm.gstin.trim() || '',
        state: newCustomerForm.state || '',
        billing_address: newCustomerForm.billing_address.trim() || '',
        shipping_address: newCustomerForm.shipping_address.trim() || '',
      } });
      setCustomers(prev => [c, ...(prev || [])]);
      setForm(f => ({ ...f, customer_id: c.customer_id, customer_name: c.customer_name, customer_gstin: c.gstin || '',
        customer_state: c.state || '', billing_address: c.billing_address || '', shipping_address: c.shipping_address || '',
        place_of_supply: c.state || '' }));
      setShowNewCustomer(false);
      toast(`Customer ${c.customer_name} created`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const setPaymentTerms = (pt) => {
    setForm(f => {
      const m = String(pt).match(/(\d+)/);
      let due = f.due_date;
      if (m && f.invoice_date) {
        const d = new Date(f.invoice_date + 'T00:00:00');
        d.setDate(d.getDate() + Number(m[1]));
        due = d.toISOString().slice(0, 10);
      } else if (!m) due = f.invoice_date;
      return { ...f, payment_terms: pt, due_date: due };
    });
  };

  const saveInvoice = async () => {
    if (!form.customer_name.trim()) { toast('Customer name required', 'error'); return; }
    const lines = form.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (lines.length === 0) { toast('Add at least one item line', 'error'); return; }
    setBusy(true);
    try {
      const payload = { ...form, customer_id: form.customer_id ? Number(form.customer_id) : null, lines: lines.map(l => ({ item_id: Number(l.item_id), qty: Number(l.qty), rate: Number(l.rate), gst_pct: Number(l.gst_pct), discount_pct: Number(l.discount_pct) || 0 })) };
      let id;
      if (editingId) {
        await api(`/sales/${editingId}`, { method: 'PUT', body: payload });
        id = editingId;
        toast('Invoice updated (DRAFT)');
      } else {
        const created = await api('/sales', { method: 'POST', body: payload });
        id = created.invoice_id;
        toast(`Invoice ${created.invoice_no} created (DRAFT)`);
      }
      const full = await api(`/sales/${id}`);
      setDetail(full);
      setCreateModal(false); setEditingId(null); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const transition = async (status) => {
    setBusy(true);
    try {
      const d = await api(`/sales/${detail.invoice_id}/status`, { method: 'PATCH', body: { status } });
      setDetail(d); load();
      toast(`Invoice marked ${status}`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const recordReturn = async () => {
    if (!returnTarget) return;
    if (!(Number(returnTarget.qty) > 0)) { toast('Return qty must be > 0', 'error'); return; }
    setBusy(true);
    try {
      const d = await api(`/sales/${detail.invoice_id}/return`, { method: 'POST', body: { line_id: returnTarget.line_id, qty: Number(returnTarget.qty), remarks: returnTarget.remarks } });
      setDetail(d); load();
      toast('Return recorded — stock updated');
      setReturnTarget(null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const cancelInvoice = async () => {
    setBusy(true);
    try {
      const d = await api(`/sales/${cancelTarget.invoice_id}/status`, { method: 'PATCH', body: { status: 'CANCELLED' } });
      setDetail(d); setCancelTarget(null); load();
      toast('Invoice cancelled');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doPrint = () => {
    setPrinting(true);
  };
  useEffect(() => {
    if (!printing || !detail) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
    return () => clearTimeout(t);
  }, [printing, detail]);

  const setLine = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, ...patch } : x) }));

  if (!inv) return <Spinner label="Loading invoices..." />;

  return (
    <div>
      <PageHeader title="Sales Invoices" subtitle="GST invoices with CGST/SGST/IGST split and stock posting on SENT"
        actions={<Button variant="primary" onClick={openNew}>+ New Invoice</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap gap-2">
          <Input placeholder="Search invoice no / customer..." value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} className="w-64" />
          <Select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-52">
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="PAID">Paid</option>
            <option value="OVERDUE">Overdue</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable keyField="invoice_id" rows={inv} onRowClick={openDetail} columns={[
          { key: 'invoice_no', label: 'Invoice No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.invoice_no}</span> },
          { key: 'customer_name', label: 'Customer', render: r => <span className="font-medium text-slate-800">{r.customer_name}</span> },
          { key: 'invoice_date', label: 'Date', render: r => fmtDate(r.invoice_date) },
          { key: 'due_date', label: 'Due', render: r => r.due_date ? fmtDate(r.due_date) : '—' },
          { key: 'invoice_total', label: 'Total', align: 'right', render: r => <span className="font-semibold text-slate-800">{inr(r.invoice_total)}</span> },
          { key: 'status', label: 'Status', align: 'center', render: r => statusBadge(r.status) },
          { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
            <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
              {r.status === 'DRAFT' && <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>}
              <Button variant="ghost" onClick={() => openDetail(r)}>Open</Button>
              {r.status !== 'CANCELLED' && r.status !== 'PAID' && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
            </div>
          ) },
        ]} />
      </Card>

      {/* ---------- New / Edit invoice ---------- */}
      {createModal && (
        <Modal title={editingId ? `Edit Invoice — ${form.invoice_no}` : 'New Sales Invoice'} onClose={() => setCreateModal(false)} wide
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveInvoice} disabled={busy}>{busy ? (editingId ? 'Saving...' : 'Creating...') : (editingId ? 'Save Changes' : 'Save as Draft')}</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <Input label="Invoice No (auto if blank)" value={form.invoice_no} onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))} />
            <Input label="Invoice Date" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
            <Input label="Due Date" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            <Select label="Payment Terms" value={form.payment_terms} onChange={e => setPaymentTerms(e.target.value)}>
              <option value="">Select terms...</option>
              {PAYMENT_TERMS.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Input label="PO Reference" value={form.po_reference} onChange={e => setForm(f => ({ ...f, po_reference: e.target.value }))} />
            <Select label="Place of Supply" value={form.place_of_supply} onChange={e => setForm(f => ({ ...f, place_of_supply: e.target.value }))}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Authorized Signatory" value={form.authorized_signatory} onChange={e => setForm(f => ({ ...f, authorized_signatory: e.target.value }))} />
          </div>

          <div className="border border-slate-200 rounded-lg p-3 mb-3 bg-slate-50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Select label="Customer *" value={form.customer_id || ''}
                onChange={e => { if (e.target.value === '__add_customer__') setShowNewCustomer(true); else pickCustomer(e.target.value); }}>
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
                <option value="__add_customer__">+ Add New Customer...</option>
              </Select>
              <Input label="Customer GSTIN" value={form.customer_gstin} onChange={e => setForm(f => ({ ...f, customer_gstin: e.target.value }))} />
              <Select label="Customer State" value={form.customer_state} onChange={e => setForm(f => ({ ...f, customer_state: e.target.value }))}>
                <option value="">Select state...</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <div className="flex items-end pb-1">
                <span className={`text-xs font-bold ${same ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {same ? 'Same state → CGST + SGST' : 'Inter-state → IGST'}
                </span>
              </div>
              <Input label="Billing Address" value={form.billing_address} onChange={e => setForm(f => ({ ...f, billing_address: e.target.value }))} className="col-span-2" />
              <Input label="Shipping Address (blank = billing)" value={form.shipping_address} onChange={e => setForm(f => ({ ...f, shipping_address: e.target.value }))} className="col-span-2" />
            </div>

            {showNewCustomer && (
              <div className="mt-2 border border-indigo-200 bg-indigo-50/60 rounded-lg p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Input label="Customer Name *" value={newCustomerForm.customer_name} placeholder="e.g. YOGI PAAD" autoFocus
                    onChange={e => setNewCustomerForm(f => ({ ...f, customer_name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') createInlineCustomer(); if (e.key === 'Escape') setShowNewCustomer(false); }} />
                  <Input label="Contact No" value={newCustomerForm.contact_no}
                    onChange={e => setNewCustomerForm(f => ({ ...f, contact_no: e.target.value }))} />
                  <Input label="GSTIN" value={newCustomerForm.gstin}
                    onChange={e => setNewCustomerForm(f => ({ ...f, gstin: e.target.value }))} />
                  <Select label="State" value={newCustomerForm.state}
                    onChange={e => setNewCustomerForm(f => ({ ...f, state: e.target.value }))}>
                    <option value="">Select state...</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Input label="Billing Address" value={newCustomerForm.billing_address}
                    onChange={e => setNewCustomerForm(f => ({ ...f, billing_address: e.target.value }))} className="col-span-2" />
                  <Input label="Shipping Address (blank = billing)" value={newCustomerForm.shipping_address}
                    onChange={e => setNewCustomerForm(f => ({ ...f, shipping_address: e.target.value }))} className="col-span-2" />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="primary" onClick={createInlineCustomer} disabled={busy || !newCustomerForm.customer_name.trim()}>
                    {busy ? 'Creating...' : 'Create Customer'}
                  </Button>
                  <Button onClick={() => setShowNewCustomer(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-slate-700">Items</h4>
            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}>+ Add Line</Button>
          </div>
          {form.lines.map((line, i) => {
            const it = items.find(x => x.item_id === Number(line.item_id));
            const c = computeLine(line, same);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2 bg-slate-50 rounded-lg p-2">
                <Select value={line.item_id} className="col-span-4"
                  onChange={e => {
                    const item = items.find(x => x.item_id === Number(e.target.value));
                    setLine(i, { item_id: e.target.value, gst_pct: item ? item.gst_pct : line.gst_pct, rate: item ? item.sale_rate : line.rate });
                  }}>
                  <option value="">Item...</option>
                  {items.map(x => <option key={x.item_id} value={x.item_id}>{x.sku} — {x.item_name}</option>)}
                </Select>
                <Input type="number" step="any" min="0" placeholder="Qty" value={line.qty} className="col-span-1"
                  onChange={e => setLine(i, { qty: e.target.value })} />
                <Input type="number" step="any" min="0" placeholder="Rate ₹" value={line.rate} className="col-span-2"
                  onChange={e => setLine(i, { rate: e.target.value })} />
                <Input type="number" step="any" min="0" max="100" placeholder="Disc %" value={line.discount_pct} className="col-span-1"
                  onChange={e => setLine(i, { discount_pct: e.target.value })} />
                <Select value={line.gst_pct} className="col-span-1"
                  onChange={e => setLine(i, { gst_pct: e.target.value })}>
                  {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                </Select>
                <div className="col-span-2 text-xs text-right text-slate-600 leading-tight">
                  <div>Taxable <b>{inr(c.taxable)}</b></div>
                  <div className="text-[10px]">
                    {same ? <>CGST {inr(c.cgst)} · SGST {inr(c.sgst)}</> : <>IGST {inr(c.igst)}</>}
                  </div>
                </div>
                <button className="col-span-1 text-rose-500 hover:text-rose-700 text-lg cursor-pointer"
                  onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, xi) => xi !== i) }))}>×</button>
              </div>
            );
          })}
          <div className="mt-3 bg-indigo-50 rounded-lg p-3 text-sm text-slate-700">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div>Taxable: <b>{inr(live.taxable)}</b></div>
              {live.cgst > 0 && <div>CGST: <b>{inr(live.cgst)}</b></div>}
              {live.sgst > 0 && <div>SGST: <b>{inr(live.sgst)}</b></div>}
              {live.igst > 0 && <div>IGST: <b>{inr(live.igst)}</b></div>}
              <div className="font-bold text-indigo-700">Grand Total: {inr(live.line_total)}</div>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{amountInWords(live.line_total)}</div>
          </div>
        </Modal>
      )}

      {/* ---------- Detail ---------- */}
      {detail && (
        <Modal title={`${detail.invoice_no} — ${detail.customer_name}`} onClose={() => setDetail(null)} wide
          footer={<>
            {detail.status === 'DRAFT' && <>
              <Button onClick={() => openEdit(detail)} disabled={busy}>Edit</Button>
              <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel</Button>
              <Button variant="success" onClick={() => transition('SENT')} disabled={busy}>Mark Sent (post stock)</Button>
            </>}
            {detail.status === 'SENT' && <>
              <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel</Button>
              <Button variant="success" onClick={() => transition('PAID')} disabled={busy}>Mark Paid</Button>
            </>}
            {detail.status === 'OVERDUE' && <>
              <Button variant="success" onClick={() => transition('PAID')} disabled={busy}>Mark Paid</Button>
            </>}
            {detail.status !== 'CANCELLED' && <Button variant="ghost" onClick={() => setPrinting(true)}>Print / PDF</Button>}
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            <div><div className="text-[11px] text-slate-500">Status</div><div>{statusBadge(detail.status)}</div></div>
            <div><div className="text-[11px] text-slate-500">Date / Due</div><div className="font-semibold">{fmtDate(detail.invoice_date)} {detail.due_date ? `→ ${fmtDate(detail.due_date)}` : ''}</div></div>
            <div><div className="text-[11px] text-slate-500">GSTIN</div><div className="font-mono text-xs">{detail.customer_gstin || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Place of Supply</div><div>{detail.place_of_supply || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Payment Terms</div><div>{detail.payment_terms || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">PO Ref</div><div>{detail.po_reference || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Gross Profit</div><div className="font-semibold text-emerald-700">{inr(detail.gross_profit)}</div></div>
            <div><div className="text-[11px] text-slate-500">COGS</div><div>{inr(detail.cogs_value)}</div></div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto mb-3">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-center px-2 py-2">Qty</th>
                <th className="text-right px-2 py-2">Rate</th>
                <th className="text-right px-2 py-2">Disc%</th>
                <th className="text-right px-2 py-2">Taxable</th>
                <th className="text-right px-2 py-2">CGST</th>
                <th className="text-right px-2 py-2">SGST</th>
                <th className="text-right px-2 py-2">IGST</th>
                <th className="text-right px-2 py-2">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {detail.lines.map(l => (
                  <tr key={l.line_id}>
                    <td className="px-3 py-2"><span className="font-mono text-xs text-indigo-700">{l.sku}</span> <span className="text-slate-500">{l.item_name}</span>
                      <span className="text-[10px] text-slate-400 ml-1">HSN {l.hsn_code}</span></td>
                    <td className="px-2 py-2 text-center">{fmt(l.qty)} {l.unit}</td>
                    <td className="px-2 py-2 text-right">{inr(l.rate)}</td>
                    <td className="px-2 py-2 text-right">{l.discount_pct ? `${l.discount_pct}%` : '—'}</td>
                    <td className="px-2 py-2 text-right">{inr(l.taxable_value)}</td>
                    <td className="px-2 py-2 text-right">{l.cgst_amount ? inr(l.cgst_amount) : '—'}</td>
                    <td className="px-2 py-2 text-right">{l.sgst_amount ? inr(l.sgst_amount) : '—'}</td>
                    <td className="px-2 py-2 text-right">{l.igst_amount ? inr(l.igst_amount) : '—'}</td>
                    <td className="px-2 py-2 text-right font-semibold">{inr(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mb-3">
            <table className="w-72 text-sm">
              <tbody>
                <tr><td className="py-0.5 px-2 text-slate-500">Taxable</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.taxable)}</td></tr>
                {detail.totals.discount > 0 && <tr><td className="py-0.5 px-2 text-slate-500">Discount</td><td className="py-0.5 px-2 text-right">− {inr(detail.totals.discount)}</td></tr>}
                {detail.totals.cgst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">CGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.cgst)}</td></tr>}
                {detail.totals.sgst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">SGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.sgst)}</td></tr>}
                {detail.totals.igst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">IGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.igst)}</td></tr>}
                <tr className="border-t-2 border-slate-300 text-base font-bold"><td className="py-1 px-2">Grand Total</td><td className="py-1 px-2 text-right">{inr(detail.totals.grand_total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="text-xs font-semibold text-slate-600 mb-1">In words: {detail.amount_in_words}</div>

          {detail.returns.length > 0 && (
            <div className="border border-rose-200 bg-rose-50 rounded-lg p-2 mb-2">
              <div className="text-[11px] font-bold uppercase text-rose-500 mb-1">Returns</div>
              {detail.returns.map(r => (
                <div key={r.return_id} className="text-xs flex justify-between py-0.5">
                  <span>{r.item_name} — {fmt(r.qty)} @ {inr(r.rate)} ({fmtDate(r.return_date)})</span>
                </div>
              ))}
            </div>
          )}

          {detail.status !== 'CANCELLED' && detail.stock_posted === 1 && detail.lines.some(l => l.qty - l.qty_returned > 0) && (
            <div className="flex flex-wrap gap-2 items-center justify-between bg-slate-50 rounded-lg p-2">
              <span className="text-xs font-semibold text-slate-600">Record return</span>
              <div className="flex gap-2">
                <Select value="" onChange={e => {
                  const line = detail.lines.find(l => l.line_id === Number(e.target.value));
                  if (line) setReturnTarget({ line_id: line.line_id, qty: Math.min(line.qty - line.qty_returned, 1), remarks: '' });
                  e.target.value = '';
                }}>
                  <option value="">Select item...</option>
                  {detail.lines.filter(l => l.qty - l.qty_returned > 0).map(l =>
                    <option key={l.line_id} value={l.line_id}>{l.sku} (max {fmt(l.qty - l.qty_returned)})</option>)}
                </Select>
              </div>
            </div>
          )}
        </Modal>
      )}

      {returnTarget && detail && (
        <Modal title={`Return — ${returnTarget.sku || 'item'}`} onClose={() => setReturnTarget(null)}
          footer={<>
            <Button onClick={() => setReturnTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={recordReturn} disabled={busy}>{busy ? 'Posting...' : 'Post Return'}</Button>
          </>}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Qty to return *" type="number" step="any" min="0" value={returnTarget.qty} autoFocus
              onChange={e => setReturnTarget(t => ({ ...t, qty: e.target.value }))} />
            <Input label="Remarks" value={returnTarget.remarks || ''} onChange={e => setReturnTarget(t => ({ ...t, remarks: e.target.value }))} />
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Invoice" message={`Cancel ${cancelTarget.invoice_no}? Stock (if posted) will be reversed. Cannot cancel after returns.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelInvoice} />
      )}

      {printing && detail && (
        <InvoiceDoc kind="SALES"
          company={detail.company}
          party={{ name: detail.customer_name, gstin: detail.customer_gstin, state: detail.customer_state, address: detail.billing_address, contact: '' }}
          doc={{ no: detail.invoice_no, date: detail.invoice_date, due_date: detail.due_date, po_reference: detail.po_reference, place_of_supply: detail.place_of_supply, payment_terms: detail.payment_terms, shipping_address: detail.shipping_address, terms_conditions: detail.terms_conditions, notes: detail.notes, signatory: detail.authorized_signatory }}
          lines={detail.lines.map(l => ({ sku: l.sku, item_name: l.item_name, hsn_code: l.hsn_code, qty: l.qty, unit: l.unit, rate: l.rate, discount_pct: l.discount_pct, taxable_value: l.taxable_value, cgst_amount: l.cgst_amount, sgst_amount: l.sgst_amount, igst_amount: l.igst_amount, line_total: l.line_total }))}
          totals={detail.totals} amount_in_words={detail.amount_in_words} returns={detail.returns} />
      )}
    </div>
  );
}
