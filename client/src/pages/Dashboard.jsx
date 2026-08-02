import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDate, fmtDateTime } from '../utils.js';
import { Card, StatCard, Spinner, Button, Badge, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const TYPE_COLORS = { RAW_MATERIAL: 'bg-sky-500', SEMI_FINISHED: 'bg-amber-500', FINISHED_GOOD: 'bg-emerald-500', SCRAP: 'bg-rose-500' };

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = async () => {
    try { setData(await api('/dashboard')); setError(''); }
    catch (e) { setError(e.message); toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  if (error && !data) return <div className="text-rose-600 p-4">{error}</div>;
  if (!data) return <Spinner label="Loading dashboard..." />;

  const txnLabel = {
    PURCHASE_IN: ['bg-emerald-50 text-emerald-700', 'Purchase IN'],
    PRODUCTION_OUTPUT_IN: ['bg-indigo-50 text-indigo-700', 'Prod Output IN'],
    PRODUCTION_CONSUMPTION_OUT: ['bg-amber-50 text-amber-700', 'Prod Consume OUT'],
    SALES_OUT: ['bg-sky-50 text-sky-700', 'Sales OUT'],
    SALES_RETURN_IN: ['bg-teal-50 text-teal-700', 'Sales Return IN'],
    SCRAP_IN: ['bg-rose-50 text-rose-700', 'Scrap IN'],
    SCRAP_OUT: ['bg-rose-50 text-rose-700', 'Scrap OUT'],
    JOB_WORK_SENT_OUT: ['bg-slate-100 text-slate-600', 'Job Work Sent'],
    JOB_WORK_RECEIVED_IN: ['bg-violet-50 text-violet-700', 'Job Work Returned'],
    ADJUSTMENT_IN: ['bg-cyan-50 text-cyan-700', 'Adjustment IN'],
    ADJUSTMENT_OUT: ['bg-cyan-50 text-cyan-700', 'Adjustment OUT'],
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500">Overview of stock, production and pending work</p>
        </div>
        <Button onClick={load}>Refresh / ताज़ा करें</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Inventory Value" value={inr(data.inventory.total_value)} tone="indigo"
          sub={`${fmt(data.inventory.total_qty)} units across ${data.inventory.item_count} items`} />
        <StatCard label="Pending Production" value={data.pending_production.cnt} tone="amber"
          sub={`${fmt(data.pending_production.pending_qty)} qty not yet completed`} />
        <StatCard label="Pending Job Work" value={data.pending_job_work.cnt} tone="sky"
          sub={`${fmt(data.pending_job_work.pending_qty)} qty with workers`} />
        <StatCard label="Low Stock Alerts" value={data.low_stock.count} tone={data.low_stock.count > 0 ? 'rose' : 'emerald'}
          sub={data.low_stock.count > 0 ? 'Reorder needed' : 'All healthy'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Inventory by Type" className="xl:col-span-1">
          <div className="space-y-3">
            {data.by_type.map(t => (
              <div key={t.item_type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">{t.item_type.replace('_', ' ')}</span>
                  <span className="text-slate-800 font-semibold">{inr(t.value)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${TYPE_COLORS[t.item_type]}`} style={{
                    width: data.inventory.total_value > 0 ? `${Math.round((t.value / data.inventory.total_value) * 100)}%` : '0%',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Low Stock Alerts / कम स्टॉक" className="xl:col-span-1">
          {data.low_stock.items.length === 0 ? (
            <div className="text-sm text-slate-400 py-6 text-center">No low stock items</div>
          ) : (
            <div className="space-y-2">
              {data.low_stock.items.map(it => (
                <button key={it.item_id} className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border border-rose-100 bg-rose-50/50 hover:bg-rose-50" onClick={() => go('items')}>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{it.sku}</div>
                    <div className="text-xs text-slate-500">{it.item_name}</div>
                  </div>
                  <div className="text-right">
                    <Badge color="red">Stock: {fmt(it.current_stock_qty)} {it.unit}</Badge>
                    <div className="text-[11px] text-slate-500 mt-1">Reorder at {fmt(it.reorder_level)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top 5 Stock by Value" className="xl:col-span-1">
          <div className="space-y-2">
            {data.top_stock.map((it, i) => (
              <div key={it.sku} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{it.item_name}</div>
                    <div className="text-xs text-slate-500">{it.sku} · {fmt(it.current_stock_qty)} {it.unit}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-800">{inr(it.current_stock_value)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Recent Transactions / हाल के लेन-देन">
        <DataTable
          keyField="ledger_id"
          rows={data.recent_transactions}
          columns={[
            { key: 'txn_date', label: 'Date', render: r => <span className="text-slate-500">{fmtDateTime(r.txn_date)}</span> },
            { key: 'sku', label: 'Item', render: r => <span className="font-medium text-slate-800">{r.sku}<span className="text-slate-400"> · {r.item_name}</span></span> },
            { key: 'txn_type', label: 'Type', render: r => {
              const [cls, lbl] = txnLabel[r.txn_type] || ['bg-slate-100 text-slate-600', r.txn_type];
              return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>{lbl}</span>;
            } },
            { key: 'qty', label: 'Qty', align: 'right', render: r => fmt(r.qty) },
            { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
            { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
            { key: 'balance_qty', label: 'Balance', align: 'right', render: r => `${fmt(r.balance_qty)} (${inr(r.balance_value)})` },
          ]}
        />
      </Card>
    </div>
  );
}
