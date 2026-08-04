import React from 'react';
import { fmt, inr, fmtDate, amountInWords } from '../utils.js';

/**
 * Full A4 GST invoice/PO document rendered for printing (mounted only while printing).
 * kind: 'SALES' | 'PURCHASE'
 */
export default function InvoiceDoc({ kind, company = {}, party = {}, doc = {}, lines = [], totals = {}, amount_in_words, returns = [] }) {
  const title = kind === 'SALES' ? 'TAX INVOICE' : 'PURCHASE ORDER';
  const cgst = totals.cgst || 0, sgst = totals.sgst || 0, igst = totals.igst || 0;
  const taxable = totals.taxable || 0, discount = totals.discount || 0;
  const grand = totals.grand_total != null ? totals.grand_total : taxable + cgst + sgst + igst;
  const words = amount_in_words || amountInWords(grand);

  const row = (l, i) => (
    <tr key={i} className="avoid-break">
      <td className="text-center px-2 py-1.5 border border-slate-300">{i + 1}</td>
      <td className="px-2 py-1.5 border border-slate-300">
        <div className="font-semibold">{l.item_name || l.sku}</div>
        {l.sku && <div className="text-[10px] text-slate-500">{l.sku}</div>}
      </td>
      <td className="text-center px-2 py-1.5 border border-slate-300 text-[11px]">{l.hsn_code || '—'}</td>
      <td className="text-center px-2 py-1.5 border border-slate-300">{fmt(l.qty)} {l.unit || ''}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{inr(l.rate)}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{l.discount_pct ? `${fmt(l.discount_pct, 0)}%` : '—'}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{inr(l.taxable_value)}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{l.cgst_amount ? inr(l.cgst_amount) : '—'}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{l.sgst_amount ? inr(l.sgst_amount) : '—'}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300">{l.igst_amount ? inr(l.igst_amount) : '—'}</td>
      <td className="text-right px-2 py-1.5 border border-slate-300 font-semibold">{inr(l.line_total)}</td>
    </tr>
  );

  return (
    <div id="print-area" className="bg-white text-slate-900 text-sm">
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <div className="text-2xl font-bold">{company.name || 'Company Name'}</div>
          <div className="text-xs text-slate-600 whitespace-pre-line">{company.address}</div>
          <div className="text-xs text-slate-600">
            {company.gstin ? <>GSTIN: <span className="font-mono">{company.gstin}</span> · </> : null}
            {company.state || ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tracking-wide">{title}</div>
          <div className="text-xs mt-1">
            <div>{kind === 'SALES' ? 'Invoice No' : 'PO No'}: <span className="font-mono font-semibold">{doc.no}</span></div>
            <div>Date: {fmtDate(doc.date)}</div>
            {doc.due_date && <div>Due Date: {fmtDate(doc.due_date)}</div>}
            {doc.vendor_invoice_no && <div>Vendor Inv: <span className="font-mono">{doc.vendor_invoice_no}</span></div>}
            {doc.po_reference && <div>PO Ref: <span className="font-mono">{doc.po_reference}</span></div>}
            {doc.place_of_supply && <div>Place of Supply: {doc.place_of_supply}</div>}
            {doc.payment_terms && <div>Payment Terms: {doc.payment_terms}</div>}
            {kind === 'PURCHASE' && doc.payment_status && <div>Payment Status: <span className="font-semibold">{doc.payment_status}</span></div>}
          </div>
        </div>
      </div>

      {/* Party block */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="border border-slate-300 rounded p-2">
          <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">{kind === 'SALES' ? 'Bill To' : 'Vendor'}</div>
          <div className="font-bold">{party.name || '—'}</div>
          <div className="text-xs text-slate-600 whitespace-pre-line">{party.address}</div>
          <div className="text-xs text-slate-600">{party.state || ''}</div>
          <div className="text-xs">{party.gstin ? <>GSTIN: <span className="font-mono">{party.gstin}</span></> : 'GSTIN: —'}</div>
          {party.contact && <div className="text-xs">Ph: {party.contact}</div>}
        </div>
        <div className="border border-slate-300 rounded p-2">
          <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">{kind === 'SALES' ? 'Ship To' : 'Delivery'}</div>
          <div className="text-xs text-slate-600 whitespace-pre-line">{doc.shipping_address || party.address || '—'}</div>
          {doc.shipping_state && <div className="text-xs text-slate-600">{doc.shipping_state}</div>}
        </div>
      </div>

      {/* Lines table */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100 text-[10px] uppercase tracking-wide">
            <th className="px-2 py-1.5 border border-slate-300">#</th>
            <th className="text-left px-2 py-1.5 border border-slate-300">Item</th>
            <th className="px-2 py-1.5 border border-slate-300">HSN</th>
            <th className="px-2 py-1.5 border border-slate-300">Qty</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">Rate</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">Disc%</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">Taxable</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">CGST</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">SGST</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">IGST</th>
            <th className="text-right px-2 py-1.5 border border-slate-300">Total</th>
          </tr>
        </thead>
        <tbody>{lines.map(row)}</tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mt-2 avoid-break">
        <table className="w-72 text-sm">
          <tbody>
            <tr><td className="py-0.5 px-2 text-slate-600">Taxable Value</td><td className="py-0.5 px-2 text-right">{inr(taxable)}</td></tr>
            {discount > 0 && <tr><td className="py-0.5 px-2 text-slate-600">Discount</td><td className="py-0.5 px-2 text-right">− {inr(discount)}</td></tr>}
            {cgst > 0 && <tr><td className="py-0.5 px-2 text-slate-600">CGST</td><td className="py-0.5 px-2 text-right">{inr(cgst)}</td></tr>}
            {sgst > 0 && <tr><td className="py-0.5 px-2 text-slate-600">SGST</td><td className="py-0.5 px-2 text-right">{inr(sgst)}</td></tr>}
            {igst > 0 && <tr><td className="py-0.5 px-2 text-slate-600">IGST</td><td className="py-0.5 px-2 text-right">{inr(igst)}</td></tr>}
            <tr className="border-t-2 border-slate-800 text-base font-bold">
              <td className="py-1 px-2">Grand Total</td><td className="py-1 px-2 text-right">{inr(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-xs font-semibold mt-1">Amount in words: {words}</div>

      {returns.length > 0 && (
        <div className="mt-3 avoid-break">
          <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">Returns</div>
          <table className="w-full border-collapse">
            <thead><tr className="bg-rose-50 text-[10px] uppercase">
              <th className="text-left px-2 py-1 border border-slate-300">Item</th>
              <th className="text-right px-2 py-1 border border-slate-300">Qty</th>
              <th className="text-right px-2 py-1 border border-slate-300">Rate</th>
              <th className="px-2 py-1 border border-slate-300">Date</th>
            </tr></thead>
            <tbody>{returns.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-1 border border-slate-300">{r.item_name || r.sku}</td>
                <td className="text-right px-2 py-1 border border-slate-300">{fmt(r.qty)}</td>
                <td className="text-right px-2 py-1 border border-slate-300">{inr(r.rate)}</td>
                <td className="text-right px-2 py-1 border border-slate-300">{fmtDate(r.return_date)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="text-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">Terms &amp; Conditions</div>
          <div className="whitespace-pre-line text-slate-700">{doc.terms_conditions || company.invoice_terms || '—'}</div>
          {doc.notes && <>
            <div className="text-[10px] font-bold uppercase text-slate-500 mb-1 mt-2">Notes</div>
            <div className="whitespace-pre-line text-slate-700">{doc.notes}</div>
          </>}
          {company.bank_details && <>
            <div className="text-[10px] font-bold uppercase text-slate-500 mb-1 mt-2">Bank Details</div>
            <div className="whitespace-pre-line text-slate-700">{company.bank_details}</div>
          </>}
        </div>
        <div className="text-right flex flex-col justify-end">
          {doc.signatory && <div className="text-xs font-semibold">{doc.signatory}</div>}
          <div className="text-xs text-slate-600 mt-8 pt-1 border-t border-slate-300 inline-block w-52 ml-auto">Authorized Signatory</div>
        </div>
      </div>
    </div>
  );
}
