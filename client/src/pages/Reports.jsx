import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate } from '../utils.js';
import { PageHeader, Card, Input, Select, Spinner, Button, useToast, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import DateRange from '../components/DateRange.jsx';
import ExportCSV from '../components/ExportCSV.jsx';
import { daysAgo } from '../utils.js';

const TABS = [
  { id: 'valuation', label: 'Stock Valuation' },
  { id: 'scrap', label: 'Scrap Valuation' },
  { id: 'variance', label: 'BOM vs Actual Cost' },
  { id: 'consumption', label: 'Material Consumption' },
  { id: 'lowstock', label: 'Low Stock / Reorder' },
];

const TYPE_LABEL = {
  RAW_MATERIAL: 'Raw Material',
  SEMI_FINISHED: 'Semi-Finished',
  FINISHED_GOOD: 'Finished Good',
  SCRAP: 'Scrap',
};

export default function Reports() {
  const [tab, setTab] = useState('valuation');
  const [range, setRange] = useState({ from: daysAgo(90), to: new Date().toISOString().slice(0, 10) });

  return (
    <div>
      <PageHeader title="Reports" subtitle="Full-detail MIS reports with date range and Excel/CSV export" />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cx('px-3 py-2 rounded-lg text-sm font-medium cursor-pointer border transition-colors',
              tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'valuation' && <StockValuation range={range} setRange={setRange} />}
      {tab === 'scrap' && <ScrapValuation range={range} setRange={setRange} />}
      {tab === 'variance' && <Variance range={range} setRange={setRange} />}
      {tab === 'consumption' && <Consumption range={range} setRange={setRange} />}
      {tab === 'lowstock' && <LowStock />}
    </div>
  );
}

function RangeFilter({ range, setRange }) {
  return <DateRange from={range.from} to={range.to} onChange={setRange} />;
}

/* ================= A. Stock Valuation ================= */
function StockValuation({ range, setRange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api('/reports/stock-valuation' + qs(range)).then(setData).catch(e => setError(e.message)); }, [range.from, range.to]);

  if (error) return <div className="text-rose-600">{error}</div>;
  if (!data) return <Spinner label="Computing valuation..." />;

  const csvCols = [
    { key: 'item_type', label: 'Type' }, { key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item' }, { key: 'unit', label: 'Unit' },
    { key: 'op_qty', label: 'Opening Qty' }, { key: 'op_value', label: 'Opening Value' },
    { key: 'pu_qty', label: 'Purchase IN Qty' }, { key: 'pu_value', label: 'Purchase IN Value' },
    { key: 'pr_qty', label: 'Production IN Qty' }, { key: 'pr_value', label: 'Production IN Value' },
    { key: 'sr_qty', label: 'Sales Return Qty' }, { key: 'sr_value', label: 'Sales Return Value' },
    { key: 'co_qty', label: 'Consumption Qty' }, { key: 'co_value', label: 'Consumption Value' },
    { key: 'so_qty', label: 'Sales Qty' }, { key: 'so_value', label: 'Sales Value' },
    { key: 'sc_qty', label: 'Scrap Qty' }, { key: 'sc_value', label: 'Scrap Value' },
    { key: 'jw_qty', label: 'Job Work Qty' }, { key: 'jw_value', label: 'Job Work Value' },
    { key: 'cl_qty', label: 'Closing Qty' }, { key: 'cl_value', label: 'Closing Value' },
  ];
  const csvRows = data.items.map(r => ({
    item_type: r.item_type, sku: r.sku, item_name: r.item_name, unit: r.unit,
    op_qty: r.opening.qty, op_value: r.opening.value,
    pu_qty: r.purchase_in.qty, pu_value: r.purchase_in.value,
    pr_qty: r.production_in.qty, pr_value: r.production_in.value,
    sr_qty: r.sales_return_in.qty, sr_value: r.sales_return_in.value,
    co_qty: r.consumption_out.qty, co_value: r.consumption_out.value,
    so_qty: r.sales_out.qty, so_value: r.sales_out.value,
    sc_qty: r.scrap_out.qty, sc_value: r.scrap_out.value,
    jw_qty: r.jobwork_out.qty, jw_value: r.jobwork_out.value,
    cl_qty: r.closing.qty, cl_value: r.closing.value,
  }));

  return (
    <Card
      title="Stock Valuation Report (Weighted Average Cost)"
      subtitle={`${data.from} to ${data.to} · Opening + IN − OUT = Closing`}
      actions={<><RangeFilter range={range} setRange={setRange} /><ExportCSV filename="stock-valuation.csv" columns={csvCols} rows={csvRows} /></>}
    >
      <div className="table-scroll overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-[11px] uppercase">
              <th className="px-2 py-2 text-left font-semibold min-w-[180px]">Item</th>
              <th className="px-2 py-2 text-right font-semibold border-l border-slate-200">Opening</th>
              <th className="px-2 py-2 text-right font-semibold border-l border-slate-200 bg-emerald-50/60">Purchase IN</th>
              <th className="px-2 py-2 text-right font-semibold bg-emerald-50/60">Prod OUT IN</th>
              <th className="px-2 py-2 text-right font-semibold bg-emerald-50/60">Sales Ret IN</th>
              <th className="px-2 py-2 text-right font-semibold bg-emerald-50/60">Other IN</th>
              <th className="px-2 py-2 text-right font-semibold border-l border-slate-200 bg-rose-50/60">Consume OUT</th>
              <th className="px-2 py-2 text-right font-semibold bg-rose-50/60">Sales OUT</th>
              <th className="px-2 py-2 text-right font-semibold bg-rose-50/60">Scrap OUT</th>
              <th className="px-2 py-2 text-right font-semibold bg-rose-50/60">Job Wk OUT</th>
              <th className="px-2 py-2 text-right font-semibold bg-rose-50/60">Other OUT</th>
              <th className="px-2 py-2 text-right font-semibold border-l border-slate-200">Closing</th>
            </tr>
            <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase">
              <th className="px-2 py-1 text-left">SKU · Type · Unit</th>
              <th className="px-2 py-1 text-right border-l border-slate-200">qty = value</th>
              <th className="px-2 py-1 text-right border-l border-slate-200">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right border-l border-slate-200">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right">qty = value</th>
              <th className="px-2 py-1 text-right border-l border-slate-200">qty = value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map(r => (
              <tr key={r.item_id} className="hover:bg-indigo-50/30">
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <div className="font-medium text-slate-800">{r.item_name}</div>
                  <div className="text-[10px] text-slate-400">{r.sku} · {r.item_type.replace('_', ' ')} · {r.unit}</div>
                </td>
                <Cell value={r.opening} />
                <Cell value={r.purchase_in} cls="border-l border-slate-100" tone="emerald" />
                <Cell value={r.production_in} tone="indigo" />
                <Cell value={r.sales_return_in} tone="teal" />
                <Cell value={r.other_in} />
                <Cell value={r.consumption_out} cls="border-l border-slate-100" tone="amber" />
                <Cell value={r.sales_out} tone="sky" />
                <Cell value={r.scrap_out} tone="rose" />
                <Cell value={r.jobwork_out} tone="violet" />
                <Cell value={r.other_out} />
                <td className="px-2 py-1.5 text-right border-l border-slate-100">
                  <div className="font-semibold">{fmt(r.closing.qty)}</div>
                  <div className="font-bold text-slate-800">{inr(r.closing.value)}</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Object.entries(data.subtotals).map(([type, s]) => (
              <tr key={type} className="bg-slate-100/80 font-semibold text-slate-700">
                <td className="px-2 py-2" colSpan={2}>{TYPE_LABEL[type]} — Subtotal</td>
                <td className="px-2 py-2 text-right border-l border-slate-200">{inr(s.total_in.value)}</td>
                <td className="px-2 py-2 text-right" colSpan={3} />
                <td className="px-2 py-2 text-right border-l border-slate-200">{inr(s.total_out.value)}</td>
                <td className="px-2 py-2 text-right" colSpan={4} />
                <td className="px-2 py-2 text-right border-l border-slate-200">
                  <div>{fmt(s.closing.qty)}</div><div>{inr(s.closing.value)}</div>
                </td>
              </tr>
            ))}
            <tr className="bg-indigo-600 text-white font-bold">
              <td className="px-2 py-2" colSpan={2}>GRAND TOTAL</td>
              <td className="px-2 py-2 text-right border-l border-white/20" colSpan={9} />
              <td className="px-2 py-2 text-right border-l border-white/20">
                <div>{fmt(data.grand_total.qty)}</div><div>{inr(data.grand_total.value)}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Cell({ value, cls, tone }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-700' : tone === 'indigo' ? 'text-indigo-700'
    : tone === 'teal' ? 'text-teal-700' : tone === 'amber' ? 'text-amber-700' : tone === 'sky' ? 'text-sky-700'
    : tone === 'rose' ? 'text-rose-700' : tone === 'violet' ? 'text-violet-700' : 'text-slate-600';
  if (!value || value.qty === 0) {
    return <td className={cx('px-2 py-1.5 text-right', cls)}><span className="text-slate-300">—</span></td>;
  }
  return (
    <td className={cx('px-2 py-1.5 text-right', cls)}>
      <div className={cx('font-semibold', toneCls)}>{fmt(value.qty)}</div>
      <div className="text-slate-500 text-xs">{inr(value.value)}</div>
    </td>
  );
}

/* ================= B. Scrap Valuation ================= */
function ScrapValuation({ range, setRange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api('/reports/scrap' + qs(range)).then(setData).catch(e => setError(e.message)); }, [range.from, range.to]);
  if (error) return <div className="text-rose-600">{error}</div>;
  if (!data) return <Spinner label="Computing scrap valuation..." />;

  const csvCols = [
    { key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Scrap Item' }, { key: 'unit', label: 'Unit' },
    { key: 'op_qty', label: 'Opening Qty' }, { key: 'op_value', label: 'Opening Value' },
    { key: 'gen_qty', label: 'Generated Qty' }, { key: 'gen_value', label: 'Generated Value' },
    { key: 'disp_qty', label: 'Disposed Qty' }, { key: 'disp_value', label: 'Disposed Value' },
    { key: 'cl_qty', label: 'Closing Qty' }, { key: 'cl_value', label: 'Closing Value' },
  ];
  const csvRows = data.items.map(r => ({
    sku: r.sku, item_name: r.item_name, unit: r.unit,
    op_qty: r.opening.qty, op_value: r.opening.value,
    gen_qty: r.generated.qty, gen_value: r.generated.value,
    disp_qty: r.disposed.qty, disp_value: r.disposed.value,
    cl_qty: r.closing.qty, cl_value: r.closing.value,
  }));

  return (
    <Card title="Scrap Valuation Report"
      subtitle="Scrap generated in production vs disposed — tracked separately from finished goods"
      actions={<><RangeFilter range={range} setRange={setRange} /><ExportCSV filename="scrap-valuation.csv" columns={csvCols} rows={csvRows} /></>}>
      <DataTable
        keyField="item_id"
        rows={data.items}
        columns={[
          { key: 'sku', label: 'Scrap Item', render: r => <span className="font-mono text-xs font-semibold text-rose-600">{r.sku}</span> },
          { key: 'item_name', label: 'Name' },
          { key: 'unit', label: 'Unit' },
          { key: 'avg_rate', label: 'Avg Rate (₹)', align: 'right', render: r => inr(r.avg_rate) },
          { key: 'opening', label: 'Opening', align: 'right', render: r => <>{fmt(r.opening.qty)} / {inr(r.opening.value)}</> },
          { key: 'generated', label: 'Generated (SCRAP IN)', align: 'right', render: r => <span className="text-emerald-700 font-semibold">{fmt(r.generated.qty)} / {inr(r.generated.value)}</span> },
          { key: 'disposed', label: 'Disposed / Sold', align: 'right', render: r => <span className="text-rose-700 font-semibold">{fmt(r.disposed.qty)} / {inr(r.disposed.value)}</span> },
          { key: 'closing', label: 'Closing', align: 'right', render: r => <span className="font-bold text-slate-800">{fmt(r.closing.qty)} / {inr(r.closing.value)}</span> },
        ]}
      />
      <div className="mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-sm flex justify-between font-semibold">
        <span>Total Scrap Stock Value</span><span>{inr(data.total.value)} ({fmt(data.total.qty)} qty)</span>
      </div>
    </Card>
  );
}

/* ================= C. BOM vs Actual Cost ================= */
function Variance({ range, setRange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api('/reports/variance' + qs(range)).then(setData).catch(e => setError(e.message)); }, [range.from, range.to]);
  if (error) return <div className="text-rose-600">{error}</div>;
  if (!data) return <Spinner label="Computing variance..." />;

  const csvCols = [
    { key: 'order_no', label: 'Order No' }, { key: 'output_name', label: 'Item' },
    { key: 'completed_date', label: 'Completed' }, { key: 'planned_qty', label: 'Planned' }, { key: 'completed_qty', label: 'Completed' },
    { key: 'estimated_cost', label: 'BOM Est. (full)' }, { key: 'est_scaled', label: 'Est. (scaled)' },
    { key: 'actual_cost', label: 'Actual' }, { key: 'variance', label: 'Variance (₹)' }, { key: 'variance_pct', label: 'Variance %' },
  ];

  return (
    <Card title="BOM Cost vs Actual Production Cost"
      subtitle="Estimated (from BOM) vs actual cost per completed production order"
      actions={<><RangeFilter range={range} setRange={setRange} /><ExportCSV filename="cost-variance.csv" columns={csvCols} rows={data.items.map(r => ({ ...r, completed_date: r.completed_date ? String(r.completed_date).slice(0, 10) : '' }))} /></>}>
      <DataTable
        keyField="prod_order_id"
        rows={data.items}
        columns={[
          { key: 'order_no', label: 'Order', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.order_no}</span> },
          { key: 'output_name', label: 'Item', render: r => <span className="font-medium">{r.output_name}</span> },
          { key: 'completed_date', label: 'Completed', render: r => fmtDate(r.completed_date) },
          { key: 'completed_qty', label: 'Qty Done', align: 'right', render: r => `${fmt(r.completed_qty)} / ${fmt(r.planned_qty)} ${r.unit}` },
          { key: 'est_material', label: 'Est (M/L/O)', align: 'right', render: r => <>{inr(r.est_material)} / {inr(r.est_labor)} / {inr(r.est_overhead)}</> },
          { key: 'est_scaled', label: 'Est. Cost', align: 'right', render: r => inr(r.est_scaled) },
          { key: 'actual_cost', label: 'Actual Cost', align: 'right', render: r => <span className="font-semibold">{inr(r.actual_cost)}</span> },
          { key: 'variance', label: 'Variance ₹', align: 'right', render: r => <span className={r.variance >= 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold'}>{r.variance >= 0 ? '+' : ''}{inr(r.variance)}</span> },
          { key: 'variance_pct', label: 'Variance %', align: 'right', render: r => (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${r.over_budget ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {r.variance_pct >= 0 ? '▲' : '▼'} {fmt(Math.abs(r.variance_pct), 1)}%
            </span>
          ) },
        ]}
      />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total Estimated</div><div className="font-bold">{inr(data.summary.estimated)}</div></div>
        <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total Actual</div><div className="font-bold">{inr(data.summary.actual)}</div></div>
        <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Net Variance</div>
          <div className={`font-bold ${data.summary.variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{data.summary.variance > 0 ? '+' : ''}{inr(data.summary.variance)}</div></div>
      </div>
    </Card>
  );
}

/* ================= D. Raw Material Consumption ================= */
function Consumption({ range, setRange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api('/reports/consumption' + qs(range)).then(setData).catch(e => setError(e.message)); }, [range.from, range.to]);
  if (error) return <div className="text-rose-600">{error}</div>;
  if (!data) return <Spinner label="Computing consumption..." />;

  const csvCols = [
    { key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item' }, { key: 'item_type', label: 'Type' }, { key: 'unit', label: 'Unit' },
    { key: 'orders_consumed', label: 'Production Orders' }, { key: 'total_qty', label: 'Total Qty Consumed' }, { key: 'total_value', label: 'Total Value' },
  ];

  return (
    <Card title="Raw Material Consumption Report"
      subtitle={`Total quantity consumed in production, ${data.from} to ${data.to}`}
      actions={<><RangeFilter range={range} setRange={setRange} /><ExportCSV filename="material-consumption.csv" columns={csvCols} rows={data.items} /></>}>
      <DataTable
        keyField="item_id"
        rows={data.items}
        columns={[
          { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs font-semibold text-indigo-700">{r.sku}</span> },
          { key: 'item_name', label: 'Name', render: r => <span className="font-medium">{r.item_name}</span> },
          { key: 'item_type', label: 'Type', render: r => <span className="text-xs text-slate-500">{r.item_type.replace('_', ' ')}</span> },
          { key: 'unit', label: 'Unit' },
          { key: 'orders_consumed', label: 'Orders', align: 'right' },
          { key: 'total_qty', label: 'Total Qty', align: 'right', render: r => <span className="font-semibold">{fmt(r.total_qty)}</span> },
          { key: 'total_value', label: 'Total Value', align: 'right', render: r => <span className="font-bold text-slate-800">{inr(r.total_value)}</span> },
        ]}
      />
      <div className="mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-sm flex justify-between font-semibold">
        <span>Total Consumed</span><span>{fmt(data.total.qty)} qty = {inr(data.total.value)}</span>
      </div>
    </Card>
  );
}

/* ================= E. Low Stock ================= */
function LowStock() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/reports/low-stock').then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <div className="text-rose-600">{error}</div>;
  if (!data) return <Spinner label="Loading..." />;

  const csvCols = [
    { key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item' }, { key: 'item_type', label: 'Type' },
    { key: 'unit', label: 'Unit' }, { key: 'reorder_level', label: 'Reorder Level' },
    { key: 'current_stock_qty', label: 'Current Stock' }, { key: 'shortage_qty', label: 'Shortage' },
    { key: 'suggested_qty', label: 'Suggested Purchase Qty' }, { key: 'current_stock_value', label: 'Stock Value' },
  ];

  return (
    <Card title="Low Stock / Reorder Report"
      subtitle="Items at or below reorder level with suggested purchase quantity"
      actions={<ExportCSV filename="low-stock.csv" columns={csvCols} rows={data} />}>
      {data.length === 0 ? (
        <div className="text-sm text-slate-400 py-8 text-center">No items below reorder level — all good!</div>
      ) : (
        <DataTable
          keyField="item_id"
          rows={data}
          columns={[
            { key: 'sku', label: 'Item', render: r => <span className="font-mono text-xs font-semibold text-rose-600">{r.sku}</span> },
            { key: 'item_name', label: 'Name' },
            { key: 'item_type', label: 'Type', render: r => <span className="text-xs text-slate-500">{r.item_type.replace('_', ' ')}</span> },
            { key: 'unit', label: 'Unit' },
            { key: 'reorder_level', label: 'Reorder Level', align: 'right' },
            { key: 'current_stock_qty', label: 'Current Stock', align: 'right', render: r => <span className="font-bold text-rose-600">{fmt(r.current_stock_qty)}</span> },
            { key: 'shortage_qty', label: 'Shortage', align: 'right', render: r => <span className="font-semibold">{fmt(r.shortage_qty)}</span> },
            { key: 'suggested_qty', label: 'Suggested Purchase', align: 'right', render: r => <span className="font-semibold text-indigo-700">{fmt(r.suggested_qty)} {r.unit}</span> },
            { key: 'last_purchase_rate', label: 'Last Rate (₹)', align: 'right', render: r => r.last_purchase_rate > 0 ? inr(r.last_purchase_rate) : '—' },
          ]}
        />
      )}
    </Card>
  );
}
