import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr, fmt, fmtDateTime } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const empty = { item_id: '', txn_type: 'ADJUSTMENT_IN', qty: '', rate: '', txn_date: '', remarks: '' };

export default function Adjustments() {
  const [items, setItems] = useState([]);
  const [scrapItems, setScrapItems] = useState([]);
  const [history, setHistory] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const [it, h] = await Promise.all([api('/items?include_inactive=0'), api('/adjustments')]);
      setItems(it);
      setScrapItems(it.filter(i => i.item_type === 'SCRAP'));
      setHistory(h);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const post = async () => {
    if (!form.item_id || !(Number(form.qty) > 0)) { toast('Select item and qty', 'error'); return; }
    setBusy(true);
    try {
      const r = await api('/adjustments', { method: 'POST', body: { ...form, qty: Number(form.qty), rate: Number(form.rate) || 0 } });
      toast(`Adjustment posted — balance now ${fmt(r.current_stock_qty)}`);
      setModal(false); setForm(empty); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  if (!history) return <Spinner label="Loading..." />;

  return (
    <div>
      <PageHeader title="Adjustments & Scrap"
        subtitle="Manual stock corrections and scrap disposal (SCRAP OUT)"
        actions={<Button variant="primary" onClick={() => setModal(true)}>+ New Adjustment</Button>} />

      <Card title="Scrap Stock" className="mb-4" pad={false}>
        <DataTable
          keyField="item_id"
          rows={scrapItems}
          columns={[
            { key: 'sku', label: 'SKU', render: r => <span className="font-mono text-xs font-semibold text-rose-600">{r.sku}</span> },
            { key: 'item_name', label: 'Scrap Item' },
            { key: 'current_stock_qty', label: 'Stock', align: 'right', render: r => <span className="font-bold">{fmt(r.current_stock_qty)} {r.unit}</span> },
            { key: 'avg_cost_rate', label: 'Avg Rate (₹)', align: 'right', render: r => inr(r.avg_cost_rate) },
            { key: 'current_stock_value', label: 'Value', align: 'right', render: r => <span className="font-bold text-slate-800">{inr(r.current_stock_value)}</span> },
            { key: 'action', label: '', sortable: false, align: 'right', render: r => (
              <Button variant="ghost" onClick={() => setForm({ ...empty, item_id: String(r.item_id), txn_type: 'SCRAP_OUT', remarks: 'Scrap disposal' })}>Dispose / Sell</Button>
            ) },
          ]}
        />
      </Card>

      <Card title="Recent Adjustments" pad={false}>
        <DataTable
          keyField="ledger_id"
          rows={history}
          columns={[
            { key: 'txn_date', label: 'Date', render: r => fmtDateTime(r.txn_date) },
            { key: 'sku', label: 'Item', render: r => <span className="font-medium">{r.sku} <span className="text-slate-400">· {r.item_name}</span></span> },
            { key: 'txn_type', label: 'Type', render: r => <span className="text-xs font-semibold text-slate-600">{r.txn_type.replace('_', ' ')}</span> },
            { key: 'qty', label: 'Qty', align: 'right', render: r => fmt(r.qty) },
            { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
            { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
            { key: 'remarks', label: 'Remarks', render: r => <span className="text-slate-500">{r.remarks}</span> },
          ]}
        />
      </Card>

      {modal && (
        <Modal title="New Stock Adjustment" onClose={() => setModal(false)}
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={post} disabled={busy}>{busy ? 'Posting...' : 'Post Adjustment'}</Button>
          </>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Item *" value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))} className="sm:col-span-2">
              <option value="">Select item...</option>
              {items.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name} (stock {fmt(i.current_stock_qty)} {i.unit})</option>)}
            </Select>
            <Select label="Transaction Type" value={form.txn_type} onChange={e => setForm(f => ({ ...f, txn_type: e.target.value }))}>
              <option value="ADJUSTMENT_IN">Adjustment IN</option>
              <option value="ADJUSTMENT_OUT">Adjustment OUT</option>
              <option value="SCRAP_OUT">Scrap OUT (dispose/sell)</option>
            </Select>
            <Input label="Qty *" type="number" step="any" min="0" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
            <Input label="Rate (₹, optional — default avg cost)" type="number" step="any" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
            <Input label="Date" type="date" value={form.txn_date} onChange={e => setForm(f => ({ ...f, txn_date: e.target.value }))} />
            <Input label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="sm:col-span-2" />
          </div>
        </Modal>
      )}
    </div>
  );
}
