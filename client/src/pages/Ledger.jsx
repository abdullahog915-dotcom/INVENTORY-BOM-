import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { inr, fmt, fmtDateTime } from '../utils.js';
import { PageHeader, Card, Input, Select, Button, Spinner, useToast } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import DateRange from '../components/DateRange.jsx';
import ExportCSV from '../components/ExportCSV.jsx';
import { daysAgo } from '../utils.js';

const TYPE_COLOR = {
  PURCHASE_IN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PRODUCTION_OUTPUT_IN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PRODUCTION_CONSUMPTION_OUT: 'bg-amber-50 text-amber-700 border-amber-200',
  SALES_OUT: 'bg-sky-50 text-sky-700 border-sky-200',
  SALES_RETURN_IN: 'bg-teal-50 text-teal-700 border-teal-200',
  SCRAP_IN: 'bg-rose-50 text-rose-700 border-rose-200',
  SCRAP_OUT: 'bg-rose-50 text-rose-700 border-rose-200',
  JOB_WORK_SENT_OUT: 'bg-slate-100 text-slate-600 border-slate-200',
  JOB_WORK_RECEIVED_IN: 'bg-violet-50 text-violet-700 border-violet-200',
  ADJUSTMENT_IN: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  ADJUSTMENT_OUT: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};
const SHORT = {
  PURCHASE_IN: 'Purchase IN', PRODUCTION_OUTPUT_IN: 'Prod OUT IN', PRODUCTION_CONSUMPTION_OUT: 'Prod Consume OUT',
  SALES_OUT: 'Sales OUT', SALES_RETURN_IN: 'Sales Return IN', SCRAP_IN: 'Scrap IN', SCRAP_OUT: 'Scrap OUT',
  JOB_WORK_SENT_OUT: 'JW Sent OUT', JOB_WORK_RECEIVED_IN: 'JW Received IN', ADJUSTMENT_IN: 'Adj IN', ADJUSTMENT_OUT: 'Adj OUT',
};

export default function Ledger() {
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState({});
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ item_id: '', from: daysAgo(90), to: new Date().toISOString().slice(0, 10), type: '' });

  useEffect(() => {
    api('/items').then(setItems).catch(() => {});
    api('/ledger/types').then(setTypes).catch(() => {});
  }, []);

  const load = async () => {
    setData(null);
    try { setData(await api('/ledger' + qs(filters))); }
    catch (e) { alert(e.message); setData({ transactions: [], opening: { qty: 0, value: 0 } }); }
  };
  useEffect(() => { load(); }, [filters.item_id, filters.from, filters.to, filters.type]);

  const inTypes = new Set(['PURCHASE_IN', 'PRODUCTION_OUTPUT_IN', 'SALES_RETURN_IN', 'SCRAP_IN', 'JOB_WORK_RECEIVED_IN', 'ADJUSTMENT_IN']);

  const csvColumns = [
    { key: 'txn_date', label: 'Date' }, { key: 'sku', label: 'SKU' }, { key: 'item_name', label: 'Item' },
    { key: 'txn_type', label: 'Type' }, { key: 'qty', label: 'Qty' }, { key: 'rate', label: 'Rate' },
    { key: 'value', label: 'Value' }, { key: 'balance_qty', label: 'Balance Qty' }, { key: 'balance_value', label: 'Balance Value' },
    { key: 'reference_type', label: 'Ref Type' }, { key: 'reference_id', label: 'Ref No' }, { key: 'remarks', label: 'Remarks' },
  ];

  return (
    <div>
      <PageHeader title="Stock Ledger / स्टॉक लेज़र"
        subtitle="Complete transaction trail with running balance — every stock movement"
        actions={data && (
          <ExportCSV filename="stock-ledger.csv" columns={csvColumns} rows={data.transactions.map(t => ({ ...t, txn_type: SHORT[t.txn_type] || t.txn_type }))} />
        )} />

      <Card className="mb-4" pad={false}>
        <div className="p-3 flex flex-wrap items-end gap-2">
          <Select value={filters.item_id} onChange={e => setFilters(f => ({ ...f, item_id: e.target.value }))} className="w-72">
            <option value="">All Items / सभी आइटम</option>
            {items.map(i => <option key={i.item_id} value={i.item_id}>{i.sku} — {i.item_name}</option>)}
          </Select>
          <Select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className="w-60">
            <option value="">All Types / सभी प्रकार</option>
            {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <DateRange from={filters.from} to={filters.to} onChange={v => setFilters(f => ({ ...f, ...v }))} />
        </div>
      </Card>

      {filters.item_id && data && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 mb-3 text-sm">
          Opening Balance (before <b>{filters.from}</b>): <b>{fmt(data.opening.qty)}</b> qty = <b>{inr(data.opening.value)}</b>
        </div>
      )}

      <Card pad={false}>
        {!data ? <Spinner label="Loading ledger..." /> : (
          <DataTable
            keyField="ledger_id"
            rows={data.transactions}
            columns={[
              { key: 'txn_date', label: 'Date', render: r => <span className="text-slate-500 whitespace-nowrap">{fmtDateTime(r.txn_date)}</span> },
              { key: 'sku', label: 'Item', render: r => <span className="font-medium text-slate-800">{r.sku}<span className="text-slate-400"> · {r.item_name}</span></span> },
              { key: 'txn_type', label: 'Type', render: r => <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TYPE_COLOR[r.txn_type] || ''}`}>{SHORT[r.txn_type] || r.txn_type}</span> },
              { key: 'qty', label: 'Qty', align: 'right', render: r => <span className="font-semibold">{fmt(r.qty)}</span> },
              { key: 'rate', label: 'Rate', align: 'right', render: r => inr(r.rate) },
              { key: 'value', label: 'Value', align: 'right', render: r => inr(r.value) },
              { key: 'balance_qty', label: 'Bal Qty', align: 'right', render: r => fmt(r.balance_qty) },
              { key: 'balance_value', label: 'Bal Value', align: 'right', render: r => <span className="font-semibold text-slate-800">{inr(r.balance_value)}</span> },
              { key: 'remarks', label: 'Remarks', render: r => <span className="text-slate-400 text-xs">{r.remarks || (r.reference_type ? `${r.reference_type}#${r.reference_id}` : '')}</span> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
