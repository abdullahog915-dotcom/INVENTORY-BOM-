import React from 'react';
import { Input } from './ui.jsx';
import { daysAgo } from '../utils.js';

export default function DateRange({ from, to, onChange, label = 'Date Range' }) {
  return (
    <div className="flex items-end gap-2">
      <Input type="date" value={from} label={label} onChange={e => onChange({ from: e.target.value, to })} />
      <Input type="date" value={to} label="to" onChange={e => onChange({ from, to: e.target.value })} />
      <button
        type="button"
        className="mb-0.5 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md"
        onClick={() => onChange({ from: daysAgo(30), to: new Date().toISOString().slice(0, 10) })}
      >
        Last 30 days
      </button>
      <button
        type="button"
        className="mb-0.5 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md"
        onClick={() => onChange({ from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })}
      >
        Today
      </button>
    </div>
  );
}
