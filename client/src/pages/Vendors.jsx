import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const empty = { vendor_name: '', vendor_type: 'SUPPLIER', contact_no: '', address: '', gstin: '' };

export default function Vendors() {
  const [vendors, setVendors] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [rateHistory, setRateHistory] = useState(null);
  const toast = useToast();

  const load = async () => {
    try { setVendors(await api('/vendors')); }
    catch (e) { toast(e.message, 'error'); setVendors([]); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setModal(true); };
  const openEdit = (v) => { setEditing(v); setForm(v); setModal(true); };

  const save = async () => {
    if (!form.vendor_name.trim()) { toast('Vendor name required', 'error'); return; }
    try {
      if (editing) await api(`/vendors/${editing.vendor_id}`, { method: 'PUT', body: form });
      else await api('/vendors', { method: 'POST', body: form });
      toast('Vendor saved'); setModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const showRates = async (v) => {
    try { setRateHistory({ vendor: v, rows: await api(`/vendors/${v.vendor_id}/rate-history`) }); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!vendors) return <Spinner label="Loading vendors..." />;

  return (
    <div>
      <PageHeader title="Vendors" subtitle="Suppliers and job workers with purchase rate history"
        actions={<Button variant="primary" onClick={openNew}>+ New Vendor</Button>} />

      <Card pad={false}>
        <DataTable
          keyField="vendor_id"
          rows={vendors}
          columns={[
            { key: 'vendor_name', label: 'Vendor Name', render: r => <span className="font-medium text-slate-800">{r.vendor_name}</span> },
            { key: 'vendor_type', label: 'Type', render: r => <span className="text-xs text-slate-500">{r.vendor_type.replace('_', ' ')}</span> },
            { key: 'contact_no', label: 'Contact' },
            { key: 'gstin', label: 'GSTIN', render: r => <span className="font-mono text-xs">{r.gstin || '—'}</span> },
            { key: 'po_count', label: 'POs', align: 'right' },
            { key: 'actions', label: '', align: 'right', sortable: false, render: r => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" onClick={(e) => { e.stopPropagation(); showRates(r); }}>Rate History</Button>
                <Button variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
              </div>
            ) },
          ]}
        />
      </Card>

      {modal && (
        <Modal title={editing ? `Edit Vendor — ${editing.vendor_name}` : 'New Vendor'} onClose={() => setModal(false)}
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save Vendor</Button>
          </>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Vendor Name *" value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} autoFocus />
            <Select label="Type" value={form.vendor_type} onChange={e => setForm(f => ({ ...f, vendor_type: e.target.value }))}>
              <option value="SUPPLIER">Supplier</option>
              <option value="JOB_WORKER">Job Worker</option>
              <option value="BOTH">Both</option>
            </Select>
            <Input label="Contact No." value={form.contact_no} onChange={e => setForm(f => ({ ...f, contact_no: e.target.value }))} />
            <Input label="GSTIN" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} />
            <Input label="Address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="sm:col-span-2" />
          </div>
        </Modal>
      )}

      {rateHistory && (
        <Modal title={`Rate History — ${rateHistory.vendor.vendor_name}`} onClose={() => setRateHistory(null)} wide>
          <DataTable
            keyField="po_line_id"
            rows={rateHistory.rows}
            emptyText="No purchases recorded yet"
            columns={[
              { key: 'po_date', label: 'Date', render: r => fmtDate(r.po_date) },
              { key: 'po_no', label: 'PO No' },
              { key: 'sku', label: 'Item', render: r => <span className="font-medium">{r.sku} <span className="text-slate-400">· {r.item_name}</span></span> },
              { key: 'qty_ordered', label: 'Ordered', align: 'right', render: r => `${fmt(r.qty_ordered)} ${r.unit}` },
              { key: 'rate', label: 'Rate (₹)', align: 'right', render: r => <span className="font-semibold">{inr(r.rate)}</span> },
              { key: 'gst_pct', label: 'GST %', align: 'right' },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
