import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Modal, Spinner, Badge, useToast, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export default function BOM({ createReq }) {
  const [items, setItems] = useState(null);
  const [boms, setBoms] = useState(null);
  const [filterItem, setFilterItem] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [versions, setVersions] = useState(null);
  const toast = useToast();

  const loadBoms = async () => {
    try { setBoms(await api('/bom' + (filterItem ? qs({ output_item_id: filterItem }) : ''))); }
    catch (e) { toast(e.message, 'error'); setBoms([]); }
  };
  useEffect(() => { loadBoms(); }, [filterItem]);

  useEffect(() => {
    api('/items').then(setItems).catch(e => toast(e.message, 'error'));
  }, []);

  const bomable = items?.filter(i => (i.item_type === 'SEMI_FINISHED' || i.item_type === 'FINISHED_GOOD'));
  const components = items?.filter(i => i.item_type === 'RAW_MATERIAL' || i.item_type === 'SEMI_FINISHED');

  const newForm = (outputItemId = '') => ({
    output_item_id: outputItemId, output_qty: 1, labor_cost: 0, overhead_pct: 10, notes: '',
    lines: [{ component_item_id: '', qty_required: 1, wastage_pct: 0 }],
  });

  const openNew = (outputItemId = '') => { setForm(newForm(outputItemId)); setModal(true); };

  useEffect(() => {
    if (createReq && createReq.page === 'bom') openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createReq]);

  const previewCost = useMemo(() => {
    if (!form || !items) return null;
    const mat = form.lines.reduce((s, l) => {
      if (!l.component_item_id) return s;
      const it = items.find(x => x.item_id === Number(l.component_item_id));
      if (!it) return s;
      const qty = Number(l.qty_required) * (1 + Number(l.wastage_pct) / 100);
      return s + qty * it.avg_cost_rate;
    }, 0);
    const labor = Number(form.labor_cost) || 0;
    const outputQty = Number(form.output_qty) || 1;
    const overhead = (mat + labor) * (Number(form.overhead_pct) || 0) / 100;
    const base = (mat + labor) / outputQty;
    const unitCost = base + overhead / outputQty;
    return { material: mat, base, overhead, unitCost };
  }, [form, items]);

  const save = async () => {
    if (!form.output_item_id) { toast('Select output item', 'error'); return; }
    const cleanLines = form.lines.filter(l => l.component_item_id && Number(l.qty_required) > 0);
    if (cleanLines.length === 0) { toast('Add at least one component', 'error'); return; }
    try {
      const body = { ...form, lines: cleanLines.map(l => ({ component_item_id: Number(l.component_item_id), qty_required: Number(l.qty_required), wastage_pct: Number(l.wastage_pct) || 0 })) };
      if (form.revising) await api(`/bom/${form.revising}/revise`, { method: 'POST', body });
      else await api('/bom', { method: 'POST', body });
      toast(form.revising ? 'New BOM version created' : 'BOM created');
      setModal(false); loadBoms();
    } catch (e) { toast(e.message, 'error'); }
  };

  const openDetail = async (row) => {
    try { setDetail(await api(`/bom/${row.bom_id}`)); }
    catch (e) { toast(e.message, 'error'); }
  };

  const startRevise = async (row) => {
    setDetail(null);
    try {
      const d = await api(`/bom/${row.bom_id}`);
      setForm({
        output_item_id: d.output_item_id, output_qty: d.output_qty, labor_cost: d.labor_cost,
        overhead_pct: d.overhead_pct, notes: d.notes || '', revising: row.bom_id,
        lines: d.lines.map(l => ({ component_item_id: String(l.component_item_id), qty_required: l.qty_required, wastage_pct: l.wastage_pct })),
      });
      setModal(true);
    } catch (e) { toast(e.message, 'error'); }
  };

  const openVersions = async (row) => {
    try { setVersions({ output: row, list: await api(`/bom/${row.bom_id}/versions`) }); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!boms || !items) return <Spinner label="Loading BOMs..." />;

  return (
    <div>
      <PageHeader title="BOM"
        subtitle="Multi-level BOM with wastage %, auto cost and version history"
        actions={<Button variant="primary" onClick={() => openNew()}>+ New BOM</Button>} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap gap-2 items-center">
          <Select value={filterItem} onChange={e => setFilterItem(e.target.value)} className="w-80">
            <option value="">All output items</option>
            {bomable?.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name}</option>)}
          </Select>
          <Button variant="ghost" onClick={() => setFilterItem('')}>Clear</Button>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          keyField="bom_id"
          rows={boms}
          onRowClick={openDetail}
          columns={[
            { key: 'sku', label: 'Output Item', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.sku}</span> },
            { key: 'item_name', label: 'Item Name', render: r => <span className="font-medium text-slate-800">{r.item_name}</span> },
            { key: 'version', label: 'Version', align: 'center', render: r => (
              <span className="inline-flex items-center gap-1">
                v{r.version} {r.is_active ? <Badge color="green">Active</Badge> : <Badge>Old</Badge>}
              </span>
            ) },
            { key: 'line_count', label: 'Lines', align: 'right' },
            { key: 'output_qty', label: 'Output Qty', align: 'right', render: r => fmt(r.output_qty) },
            { key: 'labor_cost', label: 'Labor (₹)', align: 'right', render: r => inr(r.labor_cost) },
            { key: 'overhead_pct', label: 'Overhead %', align: 'right' },
            { key: 'unit_cost', label: 'Unit Cost (₹)', align: 'right', render: r => <span className="font-bold text-slate-800">{inr(r.unit_cost)}</span> },
            { key: 'created_at', label: 'Created', render: r => fmtDate(r.created_at) },
            { key: 'actions', label: '', sortable: false, render: r => (
              <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" onClick={() => openVersions(r)}>Versions</Button>
                <Button variant="ghost" onClick={() => startRevise(r)}>Revise</Button>
              </div>
            ) },
          ]}
        />
      </Card>

      {modal && (
        <Modal title={form.revising ? 'Revise BOM (new version)' : 'Create BOM'} onClose={() => setModal(false)} wide
          footer={<>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>{form.revising ? 'Save as v+1' : 'Create BOM'}</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Select label="Output Item *" value={form.output_item_id} disabled={!!form.revising}
              onChange={e => setForm(f => ({ ...f, output_item_id: e.target.value }))} className="col-span-2 md:col-span-2">
              <option value="">Select...</option>
              {bomable.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name}</option>)}
            </Select>
            <Input label="Output Qty" type="number" step="any" value={form.output_qty} onChange={e => setForm(f => ({ ...f, output_qty: e.target.value }))} />
            <Input label="Overhead %" type="number" step="any" value={form.overhead_pct} onChange={e => setForm(f => ({ ...f, overhead_pct: e.target.value }))} />
            <Input label="Labor Cost (₹)" type="number" step="any" value={form.labor_cost} onChange={e => setForm(f => ({ ...f, labor_cost: e.target.value }))} className="col-span-2 md:col-span-1" />
            <Input label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="col-span-2 md:col-span-3" />
          </div>

          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-700">Components</h4>
            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { component_item_id: '', qty_required: 1, wastage_pct: 0 }] }))}>+ Add Line</Button>
          </div>

          <div className="space-y-2">
            {form.lines.map((line, idx) => {
              const it = items.find(x => x.item_id === Number(line.component_item_id));
              const qty = Number(line.qty_required) * (1 + Number(line.wastage_pct) / 100);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-lg p-2">
                  <Select value={line.component_item_id} className="col-span-5"
                    onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], component_item_id: e.target.value }; return { ...f, lines }; })}>
                    <option value="">Component item...</option>
                    {components.filter(c => c.item_id !== Number(form.output_item_id)).map(c => <option key={c.item_id} value={c.item_id}>{c.sku} — {c.item_name}</option>)}
                  </Select>
                  <Input label="" type="number" step="any" min="0" value={line.qty_required} placeholder="Qty"
                    onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], qty_required: e.target.value }; return { ...f, lines }; })} className="col-span-2" />
                  <Input label="" type="number" step="any" min="0" value={line.wastage_pct} placeholder="Wastage %"
                    onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], wastage_pct: e.target.value }; return { ...f, lines }; })} className="col-span-2" />
                  <div className="col-span-2 text-right text-xs text-slate-500">
                    {it ? <>{fmt(qty)} {it.unit}<div className="font-medium text-slate-700">{inr(qty * it.avg_cost_rate)}</div></> : '—'}
                  </div>
                  <button className="col-span-1 text-rose-500 hover:text-rose-700 text-lg cursor-pointer" onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>×</button>
                </div>
              );
            })}
          </div>

          {previewCost && (
            <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><div className="text-[11px] text-slate-500">Material Cost</div><div className="font-bold">{inr(previewCost.material)}</div></div>
              <div><div className="text-[11px] text-slate-500">Labor</div><div className="font-bold">{inr(Number(form.labor_cost) || 0)}</div></div>
              <div><div className="text-[11px] text-slate-500">Overhead</div><div className="font-bold">{inr(previewCost.overhead)}</div></div>
              <div><div className="text-[11px] text-slate-500">Unit Cost (per {form.output_qty || 1} {bomable?.find(i => i.item_id === Number(form.output_item_id))?.unit || 'unit'})</div><div className="font-bold text-indigo-700">{inr(previewCost.unitCost)}</div></div>
            </div>
          )}
        </Modal>
      )}

      {detail && (
        <Modal title={`BOM Detail — ${detail.sku ? '' : ''}v${detail.version}`} onClose={() => setDetail(null)} wide
          footer={<>
            <Button onClick={() => startRevise(detail)}>Revise → New Version</Button>
            <Button variant="primary" onClick={() => setDetail(null)}>Close</Button>
          </>}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-sm">
            <div><div className="text-[11px] text-slate-500">Output</div><div className="font-semibold">{detail.sku} — {detail.item_name}</div></div>
            <div><div className="text-[11px] text-slate-500">Version</div><div className="font-semibold">v{detail.version} {detail.is_active ? <Badge color="green">Active</Badge> : <Badge>Old</Badge>}</div></div>
            <div><div className="text-[11px] text-slate-500">Output Qty</div><div className="font-semibold">{fmt(detail.output_qty)}</div></div>
            <div><div className="text-[11px] text-slate-500">Labor</div><div className="font-semibold">{inr(detail.labor_cost)}</div></div>
            <div><div className="text-[11px] text-slate-500">Overhead %</div><div className="font-semibold">{detail.overhead_pct}%</div></div>
          </div>
          <DataTable
            keyField="bom_line_id"
            rows={detail.lines}
            columns={[
              { key: 'sku', label: 'Component', render: r => <span className="font-mono text-xs text-indigo-700">{r.sku}</span> },
              { key: 'item_name', label: 'Name', render: r => <span className="font-medium">{r.item_name}</span> },
              { key: 'qty_required', label: 'Qty', align: 'right', render: r => `${fmt(r.qty_required)} ${r.unit}` },
              { key: 'wastage_pct', label: 'Wastage %', align: 'right' },
              { key: 'lineValue', label: 'With Wastage', align: 'right', render: r => `${fmt(r.qtyWithWastage)} ${r.unit}` },
              { key: 'rate', label: 'Unit Rate', align: 'right', render: r => inr(r.rate) },
              { key: 'lineValue', label: 'Value', align: 'right', render: r => <span className="font-semibold">{inr(r.lineValue)}</span> },
            ]}
          />
          <div className="mt-3 bg-slate-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><div className="text-[11px] text-slate-500">Material</div><div className="font-bold">{inr(detail.cost.materialCost)}</div></div>
            <div><div className="text-[11px] text-slate-500">Labor</div><div className="font-bold">{inr(detail.cost.labor)}</div></div>
            <div><div className="text-[11px] text-slate-500">Overhead</div><div className="font-bold">{inr(detail.cost.overhead)}</div></div>
            <div><div className="text-[11px] text-slate-500">Unit Cost</div><div className="font-bold text-indigo-700">{inr(detail.cost.unitCost)}</div></div>
          </div>
        </Modal>
      )}

      {versions && versions.list && (
        <Modal title={`BOM Versions — ${versions.output.sku}`} onClose={() => setVersions(null)}>
          <DataTable
            keyField="bom_id"
            rows={versions.list}
            columns={[
              { key: 'version', label: 'Version', align: 'center', render: r => <span className="font-bold">v{r.version}</span> },
              { key: 'line_count', label: 'Lines', align: 'right' },
              { key: 'output_qty', label: 'Output Qty', align: 'right' },
              { key: 'labor_cost', label: 'Labor', align: 'right', render: r => inr(r.labor_cost) },
              { key: 'overhead_pct', label: 'Overhead %', align: 'right' },
              { key: 'is_active', label: 'Status', align: 'center', render: r => r.is_active ? <Badge color="green">Active</Badge> : <Badge>Old</Badge> },
              { key: 'created_at', label: 'Created', render: r => fmtDate(r.created_at) },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
