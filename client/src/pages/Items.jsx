import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt } from '../utils.js';
import { PageHeader, Card, Input, Select, CreatableSelect, Button, Modal, Spinner, ITEM_TYPES, UNITS, GST_SLABS, typeLabel, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import ExportCSV from '../components/ExportCSV.jsx';

const empty = {
  sku: '', item_name: '', item_type: 'RAW_MATERIAL', category: '', grp: '', unit: 'kg', hsn_code: '',
  gst_pct: 18, reorder_level: 0, current_stock_qty: 0, last_purchase_rate: 0, sale_rate: 0,
};

const BASE_GROUP_NAMES = new Set(['Raw Material', 'Semi Finished', 'Finished Good', 'Scrap']);

/* Group field that carries an item_type mapping. Selecting a base group or a
   custom sub-group sets the item's type automatically. "+ Add New Group"
   asks for a base type so BOM/production filtering keeps working. */
function TypedGroupField({ label, options = [], value, onChange, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('RAW_MATERIAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await onAdd(name, newType);
      onChange(created);           // { name, item_type }
      setNewName('');
      setAdding(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (adding) {
    return (
      <label className="block">
        {label && <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>}
        <div className="space-y-1.5">
          <input autoFocus value={newName} placeholder="New group name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setNewName(''); setAdding(false); } }}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          <div className="flex gap-1.5 items-center">
            <select value={newType} onChange={(e) => setNewType(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
              {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <Button variant="primary" className="shrink-0" onClick={submit} disabled={busy || !newName.trim()}>{busy ? 'Saving...' : 'Add'}</Button>
            <Button className="shrink-0" onClick={() => { setNewName(''); setAdding(false); }}>Cancel</Button>
          </div>
          <p className="text-[11px] text-slate-400">Base type is required so BOM and production filtering still works.</p>
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
        </div>
      </label>
    );
  }

  return (
    <Select label={label} value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__add__') setAdding(true);
        else onChange(e.target.value);
      }}>
      <option value="">Select group...</option>
      {options.map(g => (
        <option key={g.name} value={g.name}>
          {BASE_GROUP_NAMES.has(g.name) ? g.name : `${g.name} (${typeLabel(g.item_type)})`}
        </option>
      ))}
      <option value="__add__">+ Add New Group</option>
    </Select>
  );
}

export default function Items({ createReq }) {
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState({ search: '', type: '', category: '' });
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setItems(null);
    try {
      const [list, cats, grps] = await Promise.all([
        api('/items' + qs(filters)), api('/items/categories'), api('/items/groups'),
      ]);
      setItems(list); setCategories(cats); setGroups(grps);
    } catch (e) { toast(e.message, 'error'); setItems([]); }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [filters.search, filters.type, filters.category]);

  const openNew = () => { setForm(empty); setEditing(null); setModal(true); };

  useEffect(() => {
    if (createReq && createReq.page === 'items') openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createReq]);

  const openEdit = (row) => {
    const grp = groups.find(x => x.name === row.grp);
    setEditing(row);
    setForm({
      sku: row.sku, item_name: row.item_name,
      item_type: (grp && grp.item_type) || row.item_type,
      category: row.category || '',
      grp: row.grp || '', unit: row.unit, hsn_code: row.hsn_code || '', gst_pct: row.gst_pct || 0,
      reorder_level: row.reorder_level, last_purchase_rate: row.last_purchase_rate, sale_rate: row.sale_rate,
    });
    setModal(true);
  };

  const addCategory = async (name) => {
    const r = await api('/items/categories', { method: 'POST', body: { name } });
    setCategories(await api('/items/categories'));
    return r.name;
  };
  const addGroup = async (name, itemType) => {
    const r = await api('/items/groups', { method: 'POST', body: { name, item_type: itemType } });
    setGroups(await api('/items/groups'));
    return r; // { name, item_type }
  };

  const onGroupChange = (g) => {
    const name = typeof g === 'string' ? g : (g && g.name);
    const itemType = typeof g === 'string'
      ? (groups.find(x => x.name === g)?.item_type || '')
      : (g && g.item_type);
    setForm(f => ({ ...f, grp: name, item_type: itemType || f.item_type }));
  };

  const save = async () => {
    if (!form.item_name.trim()) { toast('Item name required', 'error'); return; }
    if (!editing && !form.grp) { toast('Select a group', 'error'); return; }
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
  const setSel = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  if (!items) return <Spinner label="Loading items..." />;

  const csvRows = items.map(r => ({
    sku: r.sku, item_name: r.item_name, item_type: r.item_type, category: r.category, group: r.grp,
    unit: r.unit, hsn_code: r.hsn_code, gst_pct: r.gst_pct, reorder_level: r.reorder_level,
    last_purchase_rate: r.last_purchase_rate,
    current_stock_qty: r.current_stock_qty, avg_cost_rate: r.avg_cost_rate,
    current_stock_value: r.current_stock_value, sale_rate: r.sale_rate,
  }));

  return (
    <div>
      <PageHeader
        title="Item Master"
        subtitle="Raw materials, semi-finished, finished goods and scrap items"
        actions={<Button variant="primary" onClick={openNew}>+ New Item</Button>}
      />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap items-center gap-2">
          <Input placeholder="Search SKU / Name / HSN..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} className="w-64" />
          <Select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className="w-52">
            <option value="">All Types</option>
            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} className="w-44">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="flex-1" />
          <ExportCSV filename="item-master.csv"
            columns={[{ key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item Name' }, { key: 'item_type', label: 'Type' },
              { key: 'category', label: 'Category' }, { key: 'group', label: 'Group' }, { key: 'unit', label: 'Unit' },
              { key: 'hsn_code', label: 'HSN' }, { key: 'gst_pct', label: 'GST %' }, { key: 'reorder_level', label: 'Reorder Level' },
              { key: 'last_purchase_rate', label: 'Purchase Rate' },
              { key: 'current_stock_qty', label: 'Stock Qty' }, { key: 'avg_cost_rate', label: 'Avg Cost Rate' },
              { key: 'current_stock_value', label: 'Stock Value' }, { key: 'sale_rate', label: 'Sale Rate' }]}
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
            { key: 'grp', label: 'Group' },
            { key: 'unit', label: 'Unit' },
            { key: 'hsn_code', label: 'HSN' },
            { key: 'gst_pct', label: 'GST %', align: 'right', render: r => r.gst_pct ? `${r.gst_pct}%` : '—' },
            { key: 'reorder_level', label: 'Reorder', align: 'right', render: r => fmt(r.reorder_level) },
            { key: 'last_purchase_rate', label: 'Purchase Rate', align: 'right', render: r => r.last_purchase_rate > 0 ? inr(r.last_purchase_rate) : '—' },
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
          title={editing ? `Edit Item — ${editing.sku}` : 'New Item'}
          onClose={() => setModal(false)}
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Item'}</Button>
          </>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="SKU (auto if blank)" value={form.sku} onChange={set('sku')} placeholder="RM-BRASS-002" />
            <Input label="Item Name *" value={form.item_name} onChange={set('item_name')} autoFocus placeholder="Brass Ingot" />
            <CreatableSelect label="Category" options={categories} value={form.category}
              onChange={setSel('category')} onAdd={addCategory} addLabel="+ Add New Category" placeholder="Select category..." />
            <TypedGroupField label="Group *" options={groups} value={form.grp}
              onChange={onGroupChange} onAdd={addGroup} />
            <Select label="Unit *" value={form.unit} onChange={set('unit')}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </Select>
            <Input label="HSN Code" value={form.hsn_code} onChange={set('hsn_code')} />
            <Select label="GST Rate %" value={form.gst_pct} onChange={set('gst_pct')}>
              {GST_SLABS.map(g => <option key={g} value={g}>{g}%</option>)}
            </Select>
            <Input label="Reorder Level" type="number" step="any" value={form.reorder_level} onChange={set('reorder_level')} />
            {!editing && <Input label="Opening Stock Qty" type="number" step="any" value={form.current_stock_qty} onChange={set('current_stock_qty')} hint="Only on creation" />}
            <Input label="Purchase Rate (₹)" type="number" step="any" value={form.last_purchase_rate} onChange={set('last_purchase_rate')} />
            <Input label="Sale Rate (₹)" type="number" step="any" value={form.sale_rate} onChange={set('sale_rate')} />
          </div>
        </Modal>
      )}
    </div>
  );
}