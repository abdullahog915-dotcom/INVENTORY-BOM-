export function fmt(n, dec = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function inr(n, dec = 2) {
  if (n === null || n === undefined) return '';
  return `₹${fmt(n, dec)}`;
}

export function fmtDate(str) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(str) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Download an array of objects as CSV (Excel-compatible, UTF-8 BOM). */
export function downloadCSV(filename, columns, rows) {
  const header = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c.key])).join(','));
  const csv = '\uFEFF' + [header, ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
