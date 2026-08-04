import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate, amountInWords, isSameState } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast, UNITS, GST_SLABS, typeLabel } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES, PAYMENT_TERMS } from '../constants.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function computeLine(l, same) {
  const qty = Number(l.qty_ordered) || 0, rate = Number(l.rate) || 0;
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

const poStatus = (s) => ({
  PENDING: <Badge color="amber">Pending</Badge>,
  PARTIAL: <Badge color="sky">Partial</Badge>,
  RECEIVED: <Badge color="green">Received</Badge>,
  CANCELLED: <Badge color="red">Cancelled</Badge>,
}[s] || s);

const payBadge = (s) => s === 'PAID' ? <Badge color="green">Paid</Badge> : s === 'PARTIAL' ? <Badge color="amber">Partial</Badge> : <Badge color="slate">Unpaid</Badge>;

const emptyLine = () => ({ item_id: '', qty_ordered: 1, rate: 0, discount_pct: 0, gst_pct: 18 });
const emptyForm = () => ({
  vendor_id: '', vendor_invoice_no: '', po_date: new Date().toISOString().slice(0, 10), due_date: '',
  place_of_supply: '', payment_terms: '', reference_no: '', notes: '', remarks: '', po_no: '',
  lines: [emptyLine()],
});
const emptyNewItem = () => ({ item_name: '', grp: '', category: '', unit: 'kg', hsn_code: '', gst_pct: 18 });
const emptyNewVendor = () => ({ vendor_name: '', vendor_type: 'SUPPLIER', contact_no: '', address: '', gstin: '' });
const BASE_GROUP_NAMES = new Set(['Raw Material', 'Semi Finished', 'Finished Good', 'Scrap']);

export default function Purchase({ createReq }) {
  const { current: company } = useCompany();
  const [pos, setPos] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [newItemLine, setNewItemLine] = useState(null);
  const [newItemForm, setNewItemForm] = useState(emptyNewItem());
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState(emptyNewVendor());
  const [filter, setFilter] = useState({ status: '', search: '' });
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [detail, setDetail] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amountPaid, setAmountPaid] = useState('');
  const [printing, setPrinting] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setPos(await api('/purchase' + qs(filter))); }
    catch (e) { toast(e.message, 'error'); setPos([]); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [filter.status, filter.search]);

  useEffect(() => {
    Promise.all([api('/vendors'), api('/items'), api('/items/groups')])
      .then(([v, it, g]) => { setVendors(v); setItems(it); setGroups(g); })
      .catch(e => toast(e.message, 'error'));
  }, []);

  const openNew = async () => {
    setForm(emptyForm());
    try {
      const { next_no } = await api('/purchase/next-no');
      setForm(f => ({ ...f, po_no: next_no }));
    } catch { /* server auto */ }
    setCreateModal(true);
  };

  useEffect(() => {
    if (createReq && createReq.page === 'purchase') openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createReq]);

  const openDetail = async (row) => {
    try {
      const d = await api(`/purchase/${row.po_id}`);
      setDetail(d); setAmountPaid(d.amount_paid != null ? d.amount_paid : '');
    } catch (e) { toast(e.message, 'error'); }
  };

  const vendor = vendors.find(v => v.vendor_id === Number(form.vendor_id));
  const same = isSameState(form.place_of_supply || vendor?.state, company?.state);
  const live = useMemo(() => {
    const acc = form.lines.map(l => computeLine(l, same));
    const t = acc.reduce((a, x) => ({
      taxable: a.taxable + x.taxable, cgst: a.cgst + x.cgst, sgst: a.sgst + x.sgst,
      igst: a.igst + x.igst, line_total: a.line_total + x.line_total,
    }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, line_total: 0 });
    return { ...t, taxable: round2(t.taxable), cgst: round2(t.cgst), sgst: round2(t.sgst), igst: round2(t.igst), line_total: round2(t.line_total) };
  }, [form.lines, same]);

  const setPaymentTerms = (pt) => {
    setForm(f => {
      const m = String(pt).match(/(\d+)/);
      let due = f.due_date;
      if (m && f.po_date) {
        const d = new Date(f.po_date + 'T00:00:00');
        d.setDate(d.getDate() + Number(m[1]));
        due = d.toISOString().slice(0, 10);
      } else if (!m) due = f.po_date;
      return { ...f, payment_terms: pt, due_date: due };
    });
  };

  const createPO = async () => {
    const lines = form.lines.filter(l => l.item_id && Number(l.qty_ordered) > 0);
    if (!form.vendor_id) { toast('Select vendor', 'error'); return; }
    if (lines.length === 0) { toast('Add at least one item line', 'error'); return; }
    setBusy(true);
    try {
      const po = await api('/purchase', { method: 'POST', body: { ...form, lines: lines.map(l => ({ item_id: Number(l.item_id), qty_ordered: Number(l.qty_ordered), rate: Number(l.rate), gst_pct: Number(l.gst_pct), discount_pct: Number(l.discount_pct) || 0 })) } });
      toast(`PO ${po.po_no} created`);
      setCreateModal(false); load();
      setDetail(po);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const receive = async () => {
    if (!detail) return;
    const lines = detail.lines.map(l => ({ line_id: l.po_line_id, qty_received: Number(l.__receive || 0) })).filter(l => l.qty_received > 0);
    if (lines.length === 0) { toast('Enter receive qty in at least one line', 'error'); return; }
    setBusy(true);
    try {
      const d = await api(`/purchase/${detail.po_id}/receive`, { method: 'POST', body: { lines, receive_date: new Date().toISOString().slice(0, 10) + ' 12:00:00' } });
      toast('Purchase entry posted — stock updated');
      setDetail(d); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const savePayment = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const d = await api(`/purchase/${detail.po_id}`, { method: 'PATCH', body: { amount_paid: Number(amountPaid) || 0 } });
      setDetail(d); load();
      toast('Payment updated');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const cancelPO = async () => {
    setBusy(true);
    try {
      await api(`/purchase/${cancelTarget.po_id}/cancel`, { method: 'POST' });
      toast('PO cancelled'); setCancelTarget(null); setDetail(null); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const setLine = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((x, xi) => xi === i ? { ...x, ...patch } : x) }));

  const handleVendorChange = (val) => {
    if (val === '__add_vendor__') { setShowNewVendor(true); return; }
    const v = vendors.find(x => x.vendor_id === Number(val));
    setForm(f => ({ ...f, vendor_id: val, place_of_supply: v?.state || f.place_of_supply }));
  };

  /* Create a brand-new vendor from the inline form, then select it in the PO
     without losing any other fields already filled in. */
  const createInlineVendor = async () => {
    if (!newVendorForm.vendor_name.trim()) { toast('Vendor name required', 'error'); return; }
    setBusy(true);
    try {
      const v = await api('/vendors', { method: 'POST', body: {
        vendor_name: newVendorForm.vendor_name.trim(),
        vendor_type: newVendorForm.vendor_type,
        contact_no: newVendorForm.contact_no.trim() || '',
        address: newVendorForm.address.trim() || '',
        gstin: newVendorForm.gstin.trim() || '',
      } });
      setVendors(prev => [v, ...(prev || [])]);
      setForm(f => ({ ...f, vendor_id: String(v.vendor_id), place_of_supply: v.state || f.place_of_supply }));
      setShowNewVendor(false);
      toast(`Vendor ${v.vendor_name} created`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const startNewItem = (i) => {
    setLine(i, { item_id: '' });
    setNewItemForm(emptyNewItem());
    setNewItemLine(i);
  };

  /* Create a brand-new item from the inline form (same core fields as the full
     New Item modal), then select it immediately in the current line. */
  const createInlineItem = async (i) => {
    if (!newItemForm.item_name.trim()) { toast('Item name required', 'error'); return; }
    if (!newItemForm.grp) { toast('Select a group', 'error'); return; }
    setBusy(true);
    try {
      const item = await api('/items', { method: 'POST', body: {
        item_name: newItemForm.item_name.trim(),
        grp: newItemForm.grp,
        category: newItemForm.category.trim() || '',
        unit: newItemForm.unit,
        hsn_code: newItemForm.hsn_code.trim() || '',
        gst_pct: newItemForm.gst_pct,
      } });
      setItems(prev => [item, ...(prev || [])]);
      setLine(i, { item_id: String(item.item_id), gst_pct: item.gst_pct, rate: item.last_purchase_rate || 0 });
      setNewItemLine(null);
      toast(`Item ${item.sku} created`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!printing || !detail) return;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 150);
    return () => clearTimeout(t);
  }, [printing, detail]);

  if (!pos) return <Spinner label="Loading purchase orders..." />;

  return (
    <div>
      <PageHeader title="Purchase" subtitle="Purchase orders with GST and purchase entries (stock IN at net rate)"
        actions={<Button variant="primary" onClick={openNew}>+ New Purchase Order</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap gap-2">
          <Input placeholder="Search PO / vendor / vendor invoice..." value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} className="w-64" />
          <Select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-52">
            <option value="">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="PARTIAL">Partial</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable keyField="po_id" rows={pos} onRowClick={openDetail} columns={[
          { key: 'po_no', label: 'PO No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.po_no}</span> },
          { key: 'vendor_name', label: 'Vendor', render: r => <span className="font-medium text-slate-800">{r.vendor_name || '—'}</span> },
          { key: 'po_date', label: 'Date', render: r => fmtDate(r.po_date) },
          { key: 'qty_pending', label: 'Pending Qty', align: 'right', render: r => r.qty_pending > 0 ? <span className="text-amber-600 font-semibold">{fmt(r.qty_pending)}</span> : <span className="text-emerald-600">—</span> },
          { key: 'po_total', label: 'Total', align: 'right', render: r => <span className="font-semibold text-slate-800">{inr(r.po_total)}</span> },
          { key: 'payment_status', label: 'Payment', align: 'center', render: r => payBadge(r.payment_status) },
          { key: 'status', label: 'Status', align: 'center', render: r => poStatus(r.status) },
          { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
            <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
              {r.status !== 'RECEIVED' && r.status !== 'CANCELLED' && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
              <Button variant="ghost" onClick={() => openDetail(r)}>Receive / Details</Button>
            </div>
          ) },
        ]} />
      </Card>

      {/* ---------- New PO ---------- */}
      {createModal && (
        <Modal title="New Purchase Order" onClose={() => setCreateModal(false)} wide
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={createPO} disabled={busy}>{busy ? 'Creating...' : 'Create PO'}</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <Input label="PO No (auto if blank)" value={form.po_no} onChange={e => setForm(f => ({ ...f, po_no: e.target.value }))} />
            <Input label="PO Date" type="date" value={form.po_date} onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))} />
            <Input label="Due Date" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            <Select label="Payment Terms" value={form.payment_terms} onChange={e => setPaymentTerms(e.target.value)}>
              <option value="">Select terms...</option>
              {PAYMENT_TERMS.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Select label="Vendor *" value={form.vendor_id}
              onChange={e => handleVendorChange(e.target.value)}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
              <option value="__add_vendor__">+ Add New Vendor...</option>
            </Select>
            <Input label="Vendor Invoice No" value={form.vendor_invoice_no} onChange={e => setForm(f => ({ ...f, vendor_invoice_no: e.target.value }))} />
            <Select label="Place of Supply" value={form.place_of_supply} onChange={e => setForm(f => ({ ...f, place_of_supply: e.target.value }))}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Reference No" value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} />
            <Input label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="col-span-2" />
            <Input label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="col-span-2" />
          </div>
          {showNewVendor && (
            <div className="mb-3 border border-indigo-200 bg-indigo-50/60 rounded-lg p-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Input label="Vendor Name *" value={newVendorForm.vendor_name} placeholder="e.g. Sharma Metals" autoFocus
                  onChange={e => setNewVendorForm(f => ({ ...f, vendor_name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') createInlineVendor(); if (e.key === 'Escape') setShowNewVendor(false); }} />
                <Select label="Type" value={newVendorForm.vendor_type}
                  onChange={e => setNewVendorForm(f => ({ ...f, vendor_type: e.target.value }))}>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="JOB_WORKER">Job Worker</option>
                  <option value="BOTH">Both</option>
                </Select>
                <Input label="Contact No." value={newVendorForm.contact_no}
                  onChange={e => setNewVendorForm(f => ({ ...f, contact_no: e.target.value }))} />
                <Input label="GSTIN" value={newVendorForm.gstin}
                  onChange={e => setNewVendorForm(f => ({ ...f, gstin: e.target.value }))} />
                <Input label="Address" value={newVendorForm.address}
                  onChange={e => setNewVendorForm(f => ({ ...f, address: e.target.value }))} className="col-span-2" />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="primary" onClick={createInlineVendor} disabled={busy || !newVendorForm.vendor_name.trim()}>
                  {busy ? 'Creating...' : 'Create Vendor'}
                </Button>
                <Button onClick={() => setShowNewVendor(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className={`text-xs font-bold mb-2 ${same ? 'text-emerald-700' : 'text-rose-700'}`}>
            {same ? 'Intra-state purchase → CGST + SGST (ITC claimable)' : 'Inter-state purchase → IGST (ITC claimable)'}
          </div>

          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-slate-700">Items</h4>
            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}>+ Add Line</Button>
          </div>
          {form.lines.map((line, i) => {
            const c = computeLine(line, same);
            return (
              <div key={i} className="bg-slate-50 rounded-lg p-2 mb-2">
                <div className="grid grid-cols-12 gap-2 items-center">
                  <Select value={line.item_id} className="col-span-4"
                    onChange={e => {
                      if (e.target.value === '__add_item__') { startNewItem(i); return; }
                      const item = items.find(x => x.item_id === Number(e.target.value));
                      setLine(i, { item_id: e.target.value, gst_pct: item ? item.gst_pct : line.gst_pct, rate: item ? item.last_purchase_rate : line.rate });
                    }}>
                    <option value="">Item...</option>
                    {items.filter(x => x.item_type !== 'SCRAP').map(x => <option key={x.item_id} value={x.item_id}>{x.sku} — {x.item_name}</option>)}
                    <option value="__add_item__">+ Add New Item...</option>
                  </Select>
                  <Input type="number" step="any" min="0" placeholder="Qty" value={line.qty_ordered} className="col-span-1"
                    onChange={e => setLine(i, { qty_ordered: e.target.value })} />
                  <Input type="number" step="any" min="0" placeholder="Rate ₹" value={line.rate} className="col-span-2"
                    onChange={e => setLine(i, { rate: e.target.value })} />
                  <Input type="number" step="any" min="0" max="100" placeholder="Disc %" value={line.discount_pct} className="col-span-1"
                    onChange={e => setLine(i, { discount_pct: e.target.value })} />
                  <Select value={line.gst_pct} className="col-span-1" onChange={e => setLine(i, { gst_pct: e.target.value })}>
                    {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                  </Select>
                  <div className="col-span-2 text-xs text-right text-slate-600 leading-tight">
                    <div>Net {inr(c.taxable)}</div>
                    <div className="text-[10px]">{same ? <>CGST {inr(c.cgst)}</> : <>IGST {inr(c.igst)}</>}</div>
                  </div>
                  <button className="col-span-1 text-rose-500 hover:text-rose-700 text-lg cursor-pointer"
                    onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, xi) => xi !== i) }))}>×</button>
                </div>

                {newItemLine === i && (
                  <div className="mt-2 border border-indigo-200 bg-indigo-50/60 rounded-lg p-3">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                      <Input label="Item Name *" value={newItemForm.item_name} placeholder="e.g. Brass Ingot" autoFocus
                        onChange={e => setNewItemForm(f => ({ ...f, item_name: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') createInlineItem(i); if (e.key === 'Escape') setNewItemLine(null); }} />
                      <Select label="Group *" value={newItemForm.grp}
                        onChange={e => setNewItemForm(f => ({ ...f, grp: e.target.value }))}>
                        <option value="">Select group...</option>
                        {groups.map(g => (
                          <option key={g.name} value={g.name}>
                            {BASE_GROUP_NAMES.has(g.name) ? g.name : `${g.name} (${typeLabel(g.item_type)})`}
                          </option>
                        ))}
                      </Select>
                      <Input label="Category" value={newItemForm.category} placeholder="e.g. BRASS"
                        onChange={e => setNewItemForm(f => ({ ...f, category: e.target.value }))} />
                      <Select label="Unit *" value={newItemForm.unit}
                        onChange={e => setNewItemForm(f => ({ ...f, unit: e.target.value }))}>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </Select>
                      <Input label="HSN" value={newItemForm.hsn_code} placeholder="e.g. 7403"
                        onChange={e => setNewItemForm(f => ({ ...f, hsn_code: e.target.value }))} />
                      <Select label="GST %" value={newItemForm.gst_pct}
                        onChange={e => setNewItemForm(f => ({ ...f, gst_pct: Number(e.target.value) }))}>
                        {GST_SLABS.map(g => <option key={g} value={g}>{g}%</option>)}
                      </Select>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                      <Button variant="primary" onClick={() => createInlineItem(i)} disabled={busy || !newItemForm.item_name.trim() || !newItemForm.grp}>
                        {busy ? 'Creating...' : 'Create Item'}
                      </Button>
                      <Button onClick={() => setNewItemLine(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-3 bg-indigo-50 rounded-lg p-3 text-sm text-slate-700">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div>Net Taxable: <b>{inr(live.taxable)}</b></div>
              {live.cgst > 0 && <div>CGST: <b>{inr(live.cgst)}</b></div>}
              {live.sgst > 0 && <div>SGST: <b>{inr(live.sgst)}</b></div>}
              {live.igst > 0 && <div>IGST: <b>{inr(live.igst)}</b></div>}
              <div className="font-bold text-indigo-700">Grand Total: {inr(live.line_total)}</div>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Stock is valued at net rate (GST claimed as ITC separately)</div>
          </div>
        </Modal>
      )}

      {/* ---------- Detail ---------- */}
      {detail && (
        <Modal title={`PO ${detail.po_no} — ${detail.vendor_name || ''}`} onClose={() => setDetail(null)} wide
          footer={<>
            {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && <>
              <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel PO</Button>
              <Button variant="success" onClick={receive} disabled={busy}>{busy ? 'Posting...' : 'Post Purchase Entry'}</Button>
            </>}
            {detail.status !== 'CANCELLED' && <Button variant="ghost" onClick={() => setPrinting(true)}>Print / PDF</Button>}
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            <div><div className="text-[11px] text-slate-500">Status</div><div>{poStatus(detail.status)}</div></div>
            <div><div className="text-[11px] text-slate-500">Vendor GSTIN</div><div className="font-mono text-xs">{detail.gstin || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Vendor State</div><div>{detail.vendor_state || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Vendor Invoice</div><div className="font-mono text-xs">{detail.vendor_invoice_no || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Date / Due</div><div className="font-semibold">{fmtDate(detail.po_date)} {detail.due_date ? `→ ${fmtDate(detail.due_date)}` : ''}</div></div>
            <div><div className="text-[11px] text-slate-500">Place of Supply</div><div>{detail.place_of_supply || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Payment Terms</div><div>{detail.payment_terms || '—'}</div></div>
            <div><div className="text-[11px] text-slate-500">Payment Status</div><div>{payBadge(detail.payment_status)}</div></div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto mb-3">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">Disc%</th>
                <th className="text-right px-3 py-2">Net (Taxable)</th>
                <th className="text-right px-3 py-2">GST</th>
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
                    <td className="px-3 py-2 text-right">{l.discount_pct ? `${l.discount_pct}%` : '—'}</td>
                    <td className="px-3 py-2 text-right">{inr(l.taxable_value)}</td>
                    <td className="px-3 py-2 text-right text-xs">
                      {l.cgst_amount > 0 ? <>CGST {inr(l.cgst_amount)}<br />SGST {inr(l.sgst_amount)}</>
                        : l.igst_amount > 0 ? <>IGST {inr(l.igst_amount)}</> : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmt(l.qty_received)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmt(Math.max(0, l.qty_ordered - l.qty_received))}</td>
                    {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && (
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="any" min="0" max={Math.max(0, l.qty_ordered - l.qty_received)} placeholder="0"
                          className="w-24 text-right rounded border border-slate-300 px-2 py-1 text-sm"
                          value={l.__receive || ''}
                          onChange={e => setDetail(d => ({ ...d, lines: d.lines.map(x => x.po_line_id === l.po_line_id ? { ...x, __receive: e.target.value } : x) }))} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mb-3">
            <table className="w-72 text-sm">
              <tbody>
                <tr><td className="py-0.5 px-2 text-slate-500">Net Taxable</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.taxable)}</td></tr>
                {detail.totals.discount > 0 && <tr><td className="py-0.5 px-2 text-slate-500">Discount</td><td className="py-0.5 px-2 text-right">− {inr(detail.totals.discount)}</td></tr>}
                {detail.totals.cgst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">CGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.cgst)}</td></tr>}
                {detail.totals.sgst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">SGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.sgst)}</td></tr>}
                {detail.totals.igst > 0 && <tr><td className="py-0.5 px-2 text-slate-500">IGST</td><td className="py-0.5 px-2 text-right">{inr(detail.totals.igst)}</td></tr>}
                <tr className="border-t-2 border-slate-300 text-base font-bold"><td className="py-1 px-2">Grand Total</td><td className="py-1 px-2 text-right">{inr(detail.totals.grand_total)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-3 bg-slate-50 rounded-lg p-3 mb-2">
            <div className="text-xs font-semibold text-slate-600">Payment</div>
            <Input label="Amount Paid (₹)" type="number" step="any" min="0" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className="w-44" />
            <Button onClick={savePayment} disabled={busy}>Update</Button>
            <div className="text-xs text-slate-500 pb-1.5">Due: <b className="text-slate-700">{inr(Math.max(0, (detail.totals.grand_total || 0) - (Number(detail.amount_paid) || 0)))}</b></div>
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Purchase Order" message={`Cancel ${cancelTarget.po_no}? Stock already received (if any) stays in inventory.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelPO} />
      )}

      {printing && detail && (
        <InvoiceDoc kind="PURCHASE"
          company={detail.company}
          party={{ name: detail.vendor_name, gstin: detail.gstin, state: detail.vendor_state, address: detail.vendor_address, contact: '' }}
          doc={{ no: detail.po_no, date: detail.po_date, due_date: detail.due_date, vendor_invoice_no: detail.vendor_invoice_no, place_of_supply: detail.place_of_supply, payment_terms: detail.payment_terms, payment_status: detail.payment_status, terms_conditions: detail.notes, notes: detail.remarks }}
          lines={detail.lines.map(l => ({ sku: l.sku, item_name: l.item_name, hsn_code: l.hsn_code, qty: l.qty_ordered, unit: l.unit, rate: l.rate, discount_pct: l.discount_pct, taxable_value: l.taxable_value, cgst_amount: l.cgst_amount, sgst_amount: l.sgst_amount, igst_amount: l.igst_amount, line_total: l.line_total }))}
          totals={detail.totals} amount_in_words={detail.amount_in_words} />
      )}
    </div>
  );
}
