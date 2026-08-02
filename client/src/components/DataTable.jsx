import React, { useState } from 'react';
import { cx } from './ui.jsx';

/**
 * columns: [{ key, label, align: 'left'|'right'|'center', sortable: bool, render: (row) => node }]
 * If `key` is null, the column is not sortable.
 */
export default function DataTable({ columns, rows = [], keyField = 'id', onRowClick, emptyText = 'No records found', dense }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);

  const sorted = useSortedRows(rows, sortKey, sortDir);

  return (
    <div className="table-scroll overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="bg-slate-50 text-slate-600 text-[11px] uppercase tracking-wider">
            {columns.map((c, i) => {
              const sortable = c.sortable !== false && c.key != null;
              return (
                <th key={i} className={cx('px-3 py-2 font-semibold whitespace-nowrap', alignCls(c.align))}>
                  {sortable ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-indigo-600 cursor-pointer uppercase tracking-wider"
                      onClick={() => {
                        if (sortKey === c.key) { setSortDir(d => -d); } else { setSortKey(c.key); setSortDir(1); }
                      }}
                    >
                      {c.label}
                      {sortKey === c.key && <span>{sortDir === 1 ? '▲' : '▼'}</span>}
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-slate-400">{emptyText}</td>
            </tr>
          )}
          {sorted.map((row, ri) => (
            <tr
              key={row[keyField] ?? ri}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx(
                onRowClick && 'cursor-pointer hover:bg-indigo-50/40',
                ri % 2 === 1 && 'bg-slate-50/40'
              )}
            >
              {columns.map((c, ci) => (
                <td key={ci} className={cx('px-3 py-2 whitespace-nowrap', dense ? 'py-1.5' : '', alignCls(c.align), c.tdClass)}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useSortedRows(rows, sortKey, sortDir) {
  if (!sortKey) return rows;
  return [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortDir;
  });
}

const alignCls = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
