import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, Confirm, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const jwStatus = (s) => ({
  SENT: <Badge color="amber">Sent / भेजा</Badge>,
  PARTIAL_RECEIVED: <Badge color="sky">Partial Received</Badge>,
  RECEIVED: <Badge color="green">Received / प्राप्त</Badge>,
  CANCELLED: <Badge color="red">Cancelled</Badge>,
}[s] || s);

export default function JobWork() {
  const [orders, setOrders] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ pending_only: '0', status: '' });
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', item_id: '', qty_sent: 1, job_charges: 0, sent_date: '', remarks: '' });
  const [receiveFor, setReceiveFor] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ qty_received: '', job_charges: 0, received_date: '' });
  const [cancelTarget, setCancelTarget] = useState(null);
  const toast = useToast();

  const load = async () => {
    try { setOrders(await api('/jobwork' + qs(filters))); }
    catch (e) { toast(e.message, 'error'); setOrders([]); }
  };
  useEffect(() => { load(); }, [filters.pending_only, filters.status]);

  useEffect(() => {
    Promise.all([api('/vendors'), api('/items')])
      .then(([v, it]) => { setVendors(v); setItems(it); })
      .catch(e => toast(e.message, 'error'));
  }, []);

  const jobWorkers = vendors.filter(v => v.vendor_type === 'JOB_WORKER' || v.vendor_type === 'BOTH');
  const jwItems = items.filter(i => i.item_type === 'SEMI_FINISHED' || i.item_type === 'FINISHED_GOOD');

  const create = async () => {
    if (!form.vendor_id || !form.item_id || !(Number(form.qty_sent) > 0)) { toast('Select vendor, item and qty', 'error'); return; }
    try {
      const jw = await api('/jobwork', { method: 'POST', body: { ...form, qty_sent: Number(form.qty_sent), job_charges: Number(form.job_charges) } });
      toast(`Job work ${jw.jw_no} sent — stock OUT`);
      setCreateModal(false);
      setForm({ vendor_id: '', item_id: '', qty_sent: 1, job_charges: 0, sent_date: '', remarks: '' });
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const openReceive = (row) => {
    setReceiveFor(row);
    setReceiveForm({ qty_received: row.qty_sent - row.qty_received, job_charges: row.job_charges, received_date: '' });
  };

  const receive = async () => {
    if (!(Number(receiveForm.qty_received) > 0)) { toast('Receive qty must be > 0', 'error'); return; }
    try {
      await api(`/jobwork/${receiveFor.jw_id}/receive`, { method: 'POST', body: { ...receiveForm, qty_received: Number(receiveForm.qty_received), job_charges: Number(receiveForm.job_charges) } });
      toast('Job work received — stock IN');
      setReceiveFor(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const cancelJw = async () => {
    try {
      await api(`/jobwork/${cancelTarget.jw_id}/cancel`, { method: 'POST' });
      toast('Job work cancelled — stock reversed'); setCancelTarget(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (!orders) return <Spinner label="Loading job work orders..." />;

  return (
    <div>
      <PageHeader title="Job Work / जॉब वर्क"
        subtitle="Outsourced polishing / electroplating — track material sent, received and charges"
        actions={<Button variant="primary" onClick={() => setCreateModal(true)}>+ Send for Job Work</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex gap-2">
          <Select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="w-52">
            <option value="">All Status</option>
            <option value="SENT">Sent / भेजा</option>
            <option value="PARTIAL_RECEIVED">Partial Received</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={filters.pending_only === '1'} className="w-4 h-4"
              onChange={e => setFilters(f => ({ ...f, pending_only: e.target.checked ? '1' : '0' }))} />
            Pending only
          </label>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          keyField="jw_id"
          rows={orders}
          columns={[
            { key: 'jw_no', label: 'JW No', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.jw_no}</span> },
            { key: 'vendor_name', label: 'Job Worker', render: r => <span className="font-medium text-slate-800">{r.vendor_name || '—'}</span> },
            { key: 'item_name', label: 'Item', render: r => <span className="text-slate-700">{r.item_name} <span className="text-slate-400">({r.sku})</span></span> },
            { key: 'qty_sent', label: 'Sent', align: 'right', render: r => `${fmt(r.qty_sent)} ${r.unit}` },
            { key: 'qty_received', label: 'Received', align: 'right', render: r => r.qty_received > 0 ? <span className="text-emerald-600 font-semibold">{fmt(r.qty_received)}</span> : '—' },
            { key: 'pending', label: 'Pending', align: 'right', render: r => {
              const p = r.qty_sent - r.qty_received;
              return p > 0 ? <span className="text-amber-600 font-semibold">{fmt(p)}</span> : <span className="text-slate-300">—</span>;
            } },
            { key: 'job_charges', label: 'Charges (₹)', align: 'right', render: r => inr(r.job_charges) },
            { key: 'sent_date', label: 'Sent On', render: r => fmtDate(r.sent_date) },
            { key: 'status', label: 'Status', align: 'center', render: r => jwStatus(r.status) },
            { key: 'actions', label: '', sortable: false, align: 'right', render: r => (
              <div className="flex justify-end gap-1">
                {r.status === 'SENT' || r.status === 'PARTIAL_RECEIVED' ? (
                  <>
                    <Button variant="success" onClick={() => openReceive(r)}>Receive</Button>
                    {r.qty_received === 0 && <Button variant="danger" onClick={() => setCancelTarget(r)}>Cancel</Button>}
                  </>
                ) : null}
              </div>
            ) },
          ]}
        />
      </Card>

      {createModal && (
        <Modal title="Send for Job Work / जॉब वर्क भेजें" onClose={() => setCreateModal(false)}
          footer={<>
            <Button onClick={() => setCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={create}>Send Material</Button>
          </>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Job Worker * / कारीगर" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}>
              <option value="">Select...</option>
              {jobWorkers.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
            </Select>
            <Select label="Item * (polishing / plating)" value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}>
              <option value="">Select...</option>
              {jwItems.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name} (stock {fmt(i.current_stock_qty)})</option>)}
            </Select>
            <Input label="Qty to Send *" type="number" step="any" min="1" value={form.qty_sent} onChange={e => setForm(f => ({ ...f, qty_sent: e.target.value }))} />
            <Input label="Job Charges (₹) estimate" type="number" step="any" value={form.job_charges} onChange={e => setForm(f => ({ ...f, job_charges: e.target.value }))} />
            <Input label="Sent Date" type="date" value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} />
            <Input label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
        </Modal>
      )}

      {receiveFor && (
        <Modal title={`Receive from Job Work — ${receiveFor.jw_no}`} onClose={() => setReceiveFor(null)}
          footer={<>
            <Button onClick={() => setReceiveFor(null)}>Cancel</Button>
            <Button variant="success" onClick={receive}>Receive Material</Button>
          </>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="text-sm text-slate-600">Item: <b>{receiveFor.item_name}</b> ({receiveFor.sku})</div>
            <div className="text-sm text-slate-600">Sent: <b>{fmt(receiveFor.qty_sent)}</b> {receiveFor.unit} · Already received: <b>{fmt(receiveFor.qty_received)}</b></div>
            <Input label="Qty Receiving *" type="number" step="any" min="0" max={receiveFor.qty_sent - receiveFor.qty_received} value={receiveForm.qty_received} onChange={e => setReceiveForm(f => ({ ...f, qty_received: e.target.value }))} />
            <Input label="Job Charges (₹) final" type="number" step="any" value={receiveForm.job_charges} onChange={e => setReceiveForm(f => ({ ...f, job_charges: e.target.value }))} />
            <Input label="Received Date" type="date" value={receiveForm.received_date} onChange={e => setReceiveForm(f => ({ ...f, received_date: e.target.value }))} />
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Confirm title="Cancel Job Work" message={`Cancel ${cancelTarget.jw_no}? Material sent will be returned to stock.`}
          confirmText="Yes, Cancel" danger onCancel={() => setCancelTarget(null)} onConfirm={cancelJw} />
      )}
    </div>
  );
}
