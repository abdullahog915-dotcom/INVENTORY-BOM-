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

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function two(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : '');
}

function three(n) {
  if (n >= 1000) return String(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? `${ONES[h]} Hundred${r ? ' ' : ''}` : '') + (r ? two(r) : '');
}

export function amountInWords(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Zero Rupees Only';
  const sign = n < 0 ? 'Minus ' : '';
  n = Math.abs(n);
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return `${sign}${parts.join(' ')} Rupees Only`;
}

const STATE_ABBR = {
  'ANDAMAN AND NICOBAR ISLANDS': 'AN', 'ANDHRA PRADESH': 'AP', 'ARUNACHAL PRADESH': 'AR',
  'ASSAM': 'AS', 'BIHAR': 'BR', 'CHANDIGARH': 'CH', 'CHHATTISGARH': 'CG',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': 'DD', 'DELHI': 'DL', 'GOA': 'GA',
  'GUJARAT': 'GJ', 'HARYANA': 'HR', 'HIMACHAL PRADESH': 'HP', 'JAMMU AND KASHMIR': 'JK',
  'JHARKHAND': 'JH', 'KARNATAKA': 'KA', 'KERALA': 'KL', 'LADAKH': 'LA', 'LAKSHADWEEP': 'LD',
  'MADHYA PRADESH': 'MP', 'MAHARASHTRA': 'MH', 'MANIPUR': 'MN', 'MEGHALAYA': 'ML',
  'MIZORAM': 'MZ', 'NAGALAND': 'NL', 'ODISHA': 'OD', 'PUDUCHERRY': 'PY', 'PUNJAB': 'PB',
  'RAJASTHAN': 'RJ', 'SIKKIM': 'SK', 'TAMIL NADU': 'TN', 'TELANGANA': 'TS', 'TRIPURA': 'TR',
  'UTTAR PRADESH': 'UP', 'UTTARAKHAND': 'UK', 'WEST BENGAL': 'WB',
};

export function normalizeState(s) {
  if (!s) return '';
  const up = String(s).trim().toUpperCase();
  return STATE_ABBR[up] || up;
}

export function isSameState(a, b) {
  const p = normalizeState(a), c = normalizeState(b);
  return !!p && !!c && p === c;
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

export function parseBankDetails(str) {
  if (!str) return { bank_name: '', account_no: '', ifsc: '', branch: '', holder_name: '' };
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return {
        bank_name: parsed.bank_name || '',
        account_no: parsed.account_no || '',
        ifsc: parsed.ifsc || '',
        branch: parsed.branch || '',
        holder_name: parsed.holder_name || '',
      };
    }
  } catch (e) {}
  return { bank_name: String(str), account_no: '', ifsc: '', branch: '', holder_name: '' };
}

export function stringifyBankDetails(obj) {
  if (!obj) return '';
  const { bank_name = '', account_no = '', ifsc = '', branch = '', holder_name = '' } = obj;
  if (!bank_name.trim() && !account_no.trim() && !ifsc.trim() && !branch.trim() && !holder_name.trim()) return '';
  return JSON.stringify({
    bank_name: bank_name.trim(),
    account_no: account_no.trim(),
    ifsc: ifsc.trim().toUpperCase(),
    branch: branch.trim(),
    holder_name: holder_name.trim(),
  });
}

export function parseInvoiceTerms(str) {
  if (!str) return [''];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed.length ? parsed : [''];
  } catch (e) {}
  const lines = String(str).split(/\n+/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
  return lines.length ? lines : [String(str)];
}

export function stringifyInvoiceTerms(terms) {
  if (!Array.isArray(terms)) return '';
  const cleaned = terms.map(t => String(t || '').trim()).filter(Boolean);
  return cleaned.length ? JSON.stringify(cleaned) : '';
}

export function getUPIQRUrl(upiId, name, amount, invNo) {
  if (!upiId) return '';
  const cleanId = String(upiId).trim();
  const cleanName = encodeURIComponent(name || 'Merchant');
  const cleanAmt = encodeURIComponent(amount || 0);
  const cleanNote = encodeURIComponent(`Payment for ${invNo || 'Invoice'}`);
  const upiUri = `upi://pay?pa=${cleanId}&pn=${cleanName}&am=${cleanAmt}&cu=INR&tn=${cleanNote}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUri)}`;
}

export const COPY_TYPES = [
  'Original for Recipient',
  'Duplicate for Transporter',
  'Triplicate for Supplier',
];

