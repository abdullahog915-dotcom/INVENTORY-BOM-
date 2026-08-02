import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, ITEM_TYPES, UNITS, typeLabel, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import ExportCSV from '../components/ExportCSV.jsx';

const empty = {
  sku: '', item_name: '', item_type: 'RAW_MATERIAL', category: '', unit: 'kg', hsn_code: '',
  reorder_level: 0, current_stock_qty: 0, last_purchase_rate: 0, sale_rate: 0,
};

export default function Items() {
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ search: '', type: '', category: '' });
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setItems(null);
    try {
      const [list, cats] = await Promise.all([api('/items' + qs(filters)), api('/items/categories')]);
      setItems(list); setCategories(cats);
    } catch (e) { toast(e.message, 'error'); setItems([]); }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [filters.search, filters.type, filters.category]);

  const openNew = () => { setForm(empty); setEditing(null); setModal(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      sku: row.sku, item_name: row.item_name, item_type: row.item_type, category: row.category || '',
      unit: row.unit, hsn_code: row.hsn_code || '', reorder_level: row.reorder_level,
      last_purchase_rate: row.last_purchase_rate, sale_rate: row.sale_rate,
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.item_name.trim()) { toast('Item name required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api(`/items/${editing.item_id}`, { method: 'PUT', body: form });
        toast('Item updated');
      } else {
        await api('/items', { method: 'POST', body: form });
        toast('Item created');
      }
      setModal(false); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!items) return <Spinner label="Loading items..." />;

  const csvRows = items.map(r => ({
    sku: r.sku, item_name: r.item_name, item_type: r.item_type, category: r.category,
    unit: r.unit, hsn_code: r.hsn_code, reorder_level: r.reorder_level,
    current_stock_qty: r.current_stock_qty, avg_cost_rate: r.avg_cost_rate,
    current_stock_value: r.current_stock_value, sale_rate: r.sale_rate,
  }));

  return (
    <div>
      <PageHeader
        title="Item Master / आइटम मास्टर"
        subtitle="Raw materials, semi-finished, finished goods and scrap items"
        actions={<Button variant="primary" onClick={openNew}>+ New Item / नया आइटम</Button>}
      />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap items-center gap-2">
          <Input placeholder="Search SKU / Name / HSN..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} className="w-64" />
          <Select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className="w-52">
            <option value="">All Types / सभी प्रकार</option>
            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} className="w-44">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="flex-1" />
          <ExportCSV filename="item-master.csv"
            columns={[{ key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item Name' }, { key: 'item_type', label: 'Type' },
              { key: 'category', label: 'Category' }, { key: 'unit', label: 'Unit' }, { key: 'hsn_code', label: 'HSN' },
              { key: 'reorder_level', label: 'Reorder Level' }, { key: 'current_stock_qty', label: 'Stock Qty' },
              { key: 'avg_cost_rate', label: 'Avg Cost Rate' }, { key: 'current_stock_value', label: 'Stock Value' }, { key: 'sale_rate', label: 'Sale Rate' }]}
            rows={csvRows} />
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          keyField="item_id"
          rows={items}
          onRowClick={openEdit}
          columns={[
            { key: 'sku', label: 'SKU', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.sku}</span> },
            { key: 'item_name', label: 'Item Name', render: r => <span className="font-medium text-slate-800">{r.item_name}</span> },
            { key: 'item_type', label: 'Type', render: r => <span className="text-xs text-slate-500">{typeLabel(r.item_type)}</span> },
            { key: 'category', label: 'Category' },
            { key: 'unit', label: 'Unit' },
            { key: 'hsn_code', label: 'HSN' },
            { key: 'reorder_level', label: 'Reorder', align: 'right', render: r => fmt(r.reorder_level) },
            { key: 'current_stock_qty', label: 'Stock', align: 'right',
              render: r => <span className={r.current_stock_qty <= r.reorder_level && r.reorder_level > 0 ? 'font-semibold text-rose-600' : ''}>{fmt(r.current_stock_qty)} {r.unit}</span> },
            { key: 'avg_cost_rate', label: 'Avg Cost', align: 'right', render: r => inr(r.avg_cost_rate) },
            { key: 'current_stock_value', label: 'Stock Value', align: 'right', render: r => <span className="font-semibold text-slate-800">{inr(r.current_stock_value)}</span> },
            { key: 'sale_rate', label: 'Sale Rate', align: 'right', render: r => inr(r.sale_rate) },
          ]}
        />
      </Card>

      {modal && (
        <Modal
          title={editing ? `Edit Item — ${editing.sku}` : 'New Item / नया आइटम'}
          onClose={() => setModal(false)}
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Item'}</Button>
          </>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="SKU (auto if blank)" value={form.sku} onChange={set('sku')} placeholder="RM-BRASS-002" />
            <Input label="Item Name * / नाम" value={form.item_name} onChange={set('item_name')} autoFocus placeholder="Brass Ingot" />
            <Select label="Type * / प्रकार" value={form.item_type} onChange={set('item_type')}>
              {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Input label="Category / श्रेणी" value={form.category} onChange={set('category')} placeholder="Brass" list="catlist" />
            <datalist id="catlist">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <Select label="Unit * / इकाई" value={form.unit} onChange={set('unit')}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </Select>
            <Input label="HSN Code" value={form.hsn_code} onChange={set('hsn_code')} />
            <Input label="Reorder Level / पुनः-ऑर्डर स्तर" type="number" step="any" value={form.reorder_level} onChange={set('reorder_level')} />
            {!editing && <Input label="Opening Stock Qty" type="number" step="any" value={form.current_stock_qty} onChange={set('current_stock_qty')} hint="Only on creation" />}
            <Input label="Purchase Rate (₹) / खरीद दर" type="number" step="any" value={form.last_purchase_rate} onChange={set('last_purchase_rate')} />
            <Input label="Sale Rate (₹) / बिक्री दर" type="number" step="any" value={form.sale_rate} onChange={set('sale_rate')} />
          </div>
        </Modal>
      )}
    </div>
  );
}
