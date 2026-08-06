import { round2 } from './ledger.js';

/** Indian state/UT names mapped to their 2-letter GST codes. */
const STATE_ABBR = {
  'ANDAMAN AND NICOBAR ISLANDS': 'AN',
  'ANDHRA PRADESH': 'AP',
  'ARUNACHAL PRADESH': 'AR',
  'ASSAM': 'AS',
  'BIHAR': 'BR',
  'CHANDIGARH': 'CH',
  'CHHATTISGARH': 'CG',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': 'DD',
  'DELHI': 'DL',
  'GOA': 'GA',
  'GUJARAT': 'GJ',
  'HARYANA': 'HR',
  'HIMACHAL PRADESH': 'HP',
  'JAMMU AND KASHMIR': 'JK',
  'JHARKHAND': 'JH',
  'KARNATAKA': 'KA',
  'KERALA': 'KL',
  'LADAKH': 'LA',
  'LAKSHADWEEP': 'LD',
  'MADHYA PRADESH': 'MP',
  'MAHARASHTRA': 'MH',
  'MANIPUR': 'MN',
  'MEGHALAYA': 'ML',
  'MIZORAM': 'MZ',
  'NAGALAND': 'NL',
  'ODISHA': 'OD',
  'PUDUCHERRY': 'PY',
  'PUNJAB': 'PB',
  'RAJASTHAN': 'RJ',
  'SIKKIM': 'SK',
  'TAMIL NADU': 'TN',
  'TELANGANA': 'TS',
  'TRIPURA': 'TR',
  'UTTAR PRADESH': 'UP',
  'UTTARAKHAND': 'UK',
  'WEST BENGAL': 'WB',
};

/** Normalizes a state value (full name or code) to its 2-letter code, so
    "Uttar Pradesh", "UP" and "up" all compare equal. */
export function normalizeState(s) {
  if (!s) return '';
  const up = String(s).trim().toUpperCase();
  return STATE_ABBR[up] || up;
}

/** True when party (customer/vendor) is in the same state as the company (CGST+SGST) */
export function isSameState(partyState, companyState) {
  const p = normalizeState(partyState);
  const c = normalizeState(companyState);
  return !!p && !!c && p === c;
}

/** Splits a GST amount into CGST/SGST (intra-state) or IGST (inter-state). */
export function splitGst(gstAmount, sameState) {
  gstAmount = round2(gstAmount);
  if (sameState) {
    const cgst = round2(gstAmount / 2);
    return { cgst, sgst: round2(gstAmount - cgst), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: gstAmount };
}

/**
 * Computes every monetary field for one invoice/PO line.
 * rate is the pre-discount unit rate (exclusive of GST).
 */
export function computeLine({ rate, qty, gst_pct, discount_pct }, sameState) {
  qty = Number(qty) || 0;
  rate = Number(rate) || 0;
  const gstPct = Number(gst_pct) || 0;
  const discountPct = Number(discount_pct) || 0;
  const gross = round2(qty * rate);
  const discount = round2(gross * discountPct / 100);
  const taxable = round2(gross - discount);
  const gstAmount = round2(taxable * gstPct / 100);
  const tax = splitGst(gstAmount, sameState);
  return {
    gross,
    discount,
    taxable,
    gst_amount: gstAmount,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    line_total: round2(taxable + tax.cgst + tax.sgst + tax.igst),
  };
}

/** Footer totals from an array of already-computed line objects.
    discount_amount is a flat (₹) discount applied after line-level % discounts. */
export function computeTotals(lines, other_charges = 0, discount_amount = 0) {
  const otherCharges = Number(other_charges) || 0;
  const flatDiscount = round2(Number(discount_amount) || 0);
  const t = lines.reduce((a, l) => ({
    gross: round2(a.gross + (l.gross || 0)),
    discount: round2(a.discount + (l.discount || 0)),
    taxable: round2(a.taxable + (l.taxable || 0)),
    cgst: round2(a.cgst + (l.cgst || 0)),
    sgst: round2(a.sgst + (l.sgst || 0)),
    igst: round2(a.igst + (l.igst || 0)),
    total_weight: round2(a.total_weight + (l.weight || 0)),
  }), { gross: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total_weight: 0 });

  t.discount_amount = flatDiscount;
  t.net_taxable = round2(t.taxable - flatDiscount);
  t.other_charges = otherCharges;
  const grossTotal = round2(t.net_taxable + t.cgst + t.sgst + t.igst + otherCharges);
  const grandTotal = Math.round(grossTotal);
  t.round_off = round2(grandTotal - grossTotal);
  t.grand_total = grandTotal;
  t.gst_value = round2(t.cgst + t.sgst + t.igst);
  return t;
}

/* ---------------- Amount in words (Indian numbering) ---------------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : '');
}

function threeDigits(n) {
  if (n >= 1000) return String(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? `${ONES[h]} Hundred${r ? ' ' : ''}` : '') + (r ? twoDigits(r) : '');
}

export function numberToWordsINR(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Zero Rupees Only';
  const sign = n < 0 ? 'Minus ' : '';
  n = Math.abs(n);
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return `${sign}${parts.join(' ')} Rupees Only`;
}
