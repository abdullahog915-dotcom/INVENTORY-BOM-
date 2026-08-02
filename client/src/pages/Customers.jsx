import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import ExportCSV from '../components/ExportCSV.jsx';
import { INDIAN_STATES } from '../constants.js';

const empty = { customer_name: '', billing_address: '', shipping_address: '', gstin: '', state: '', contact_no: '' };

export default function Customers() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setRows(null);
    try { setRows(await api('/customers' + qs({ search }))); }
    catch (e) { toast(e.message, 'error'); setRows([]); }
  };

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const openNew = () => { setForm(empty); setEditing(null); setModal(true); };
  const openEdit = (r) => {
    setEditing(r);
    setForm({ customer_name: r.customer_name, billing_address: r.billing_address || '', shipping_address: r.shipping_address || '', gstin: r.gstin || '', state: r.state || '', contact_no: r.contact_no || '' });
    setModal(true);
  };

  const save = async () => {
    if (!form.customer_name.trim()) { toast('Customer name required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) { await api(`/customers/${editing.customer_id}`, { method: 'PUT', body: form }); toast('Customer updated'); }
      else { await api('/customers', { method: 'POST', body: form }); toast('Customer created'); }
      setModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!rows) return <Spinner label="Loading customers..." />;

  return (
    <div>
      <PageHeader title="Customers / ग्राहक" subtitle="Sales parties with GST details for invoicing"
        actions={<Button variant="primary" onClick={openNew}>+ New Customer</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap items-center gap-2">
          <Input placeholder="Search name / GSTIN / phone..." value={search} onChange={e => setSearch(e.target.value)} className="w-64" />
          <div className="flex-1" />
          <ExportCSV filename="customers.csv" columns={[{ key: 'customer_name', label: 'Name' }, { key: 'gstin', label: 'GSTIN' },
            { key: 'state', label: 'State' }, { key: 'billing_address', label: 'Billing Address' }, { key: 'contact_no', label: 'Contact' }]}
            rows={rows} />
        </div>
      </Card>

      <Card pad={false}>
        <DataTable keyField="customer_id" rows={rows} onRowClick={openEdit} columns={[
          { key: 'customer_name', label: 'Name', render: r => <span className="font-medium text-slate-800">{r.customer_name}</span> },
          { key: 'gstin', label: 'GSTIN', render: r => r.gstin ? <span className="font-mono text-xs">{r.gstin}</span> : '—' },
          { key: 'state', label: 'State', render: r => r.state || '—' },
          { key: 'billing_address', label: 'Billing Address' },
          { key: 'contact_no', label: 'Contact' },
          { key: 'invoice_count', label: 'Invoices', align: 'right' },
        ]} />
      </Card>

      {modal && (
        <Modal title={editing ? 'Edit Customer' : 'New Customer / नया ग्राहक'} onClose={() => setModal(false)}
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Customer'}</Button>
          </>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Customer Name *" value={form.customer_name} onChange={set('customer_name')} autoFocus />
            <Input label="GSTIN" value={form.gstin} onChange={set('gstin')} />
            <Select label="State / राज्य" value={form.state} onChange={set('state')}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Contact No" value={form.contact_no} onChange={set('contact_no')} />
            <Input label="Billing Address" value={form.billing_address} onChange={set('billing_address')} className="sm:col-span-2" />
            <Input label="Shipping Address (blank = billing)" value={form.shipping_address} onChange={set('shipping_address')} className="sm:col-span-2" />
          </div>
        </Modal>
      )}
    </div>
  );
}
