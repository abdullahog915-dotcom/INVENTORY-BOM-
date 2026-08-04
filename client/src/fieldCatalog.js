/**
 * Field Catalog — Single source of truth for all GST Tax Invoice fields.
 * Sections map to InvoiceDoc print layout sections.
 * Each field: key, label (EN/HI), section, type, group (core display fields vs billing charges),
 * defaultVisible (company template default), options, placeholder, source.
 */

export const FIELD_SECTIONS = [
  { id: 'header', label: 'Header — Company Info', icon: '🏢' },
  { id: 'meta', label: 'Invoice Meta', icon: '📄' },
  { id: 'transport', label: 'Transport & Delivery', icon: '🚛' },
  { id: 'billto', label: 'Bill To / Party', icon: '👤' },
  { id: 'shipto', label: 'Ship To', icon: '📦' },
  { id: 'items', label: 'Line Items & Charges', icon: '🧾' },
  { id: 'payment', label: 'Payment & Bank', icon: '💳' },
  { id: 'legal', label: 'Legal & Declarations', icon: '⚖️' },
  { id: 'signature', label: 'Signature Block', icon: '✍️' },
  { id: 'einvoice', label: 'E-Invoice / Advanced', icon: '🔐' },
];

/* ---- Core display field definitions ---- */
export const ALL_FIELDS = [
  /* ===== HEADER ===== */
  { key: 'company_logo', label: 'Company Logo', section: 'header', type: 'logo', defaultVisible: false, source: 'company' },
  { key: 'company_name', label: 'Company Name', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'company_address', label: 'Company Address (with PIN)', section: 'header', type: 'textarea', defaultVisible: true, source: 'company' },
  { key: 'company_gstin', label: 'GSTIN', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'company_state_code', label: 'State + State Code', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'company_phone', label: 'Phone / Mobile No', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'company_email', label: 'Email ID', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'company_website', label: 'Website', section: 'header', type: 'text', defaultVisible: false, source: 'company' },
  { key: 'company_pan', label: 'PAN Number', section: 'header', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'title', label: '\u201cTAX INVOICE\u201d Title + Copy Label', section: 'header', type: 'boolean', defaultVisible: true },

  /* ===== META ===== */
  { key: 'invoice_no', label: 'Invoice Number (sequential)', section: 'meta', type: 'text', defaultVisible: true, source: 'invoice' },
  { key: 'invoice_date', label: 'Invoice Date', section: 'meta', type: 'date', defaultVisible: true, source: 'invoice' },
  { key: 'due_date', label: 'Due Date', section: 'meta', type: 'date', defaultVisible: true, source: 'invoice' },
  { key: 'place_of_supply', label: 'Place of Supply', section: 'meta', type: 'select', options: 'states', defaultVisible: true, source: 'invoice' },
  { key: 'reference_no', label: 'Reference / Buyer Order No (PO Ref)', section: 'meta', type: 'text', defaultVisible: true, source: 'invoice' },
  { key: 'order_date', label: 'Order Date', section: 'meta', type: 'date', defaultVisible: false, source: 'invoice' },
  { key: 'date_of_supply', label: 'Date of Supply / Delivery', section: 'meta', type: 'date', defaultVisible: false, source: 'invoice' },
  { key: 'copy_type', label: 'Original / Duplicate / Triplicate', section: 'meta', type: 'select', options: 'copies', defaultVisible: true, source: 'invoice' },

  /* ===== TRANSPORT ===== */
  { key: 'transport_mode', label: 'Transport Mode (Road/Rail/Air/Ship)', section: 'transport', type: 'select', options: ['Road', 'Rail', 'Air', 'Ship'], defaultVisible: true, source: 'invoice' },
  { key: 'vehicle_no', label: 'Vehicle Number', section: 'transport', type: 'text', defaultVisible: true, source: 'invoice' },
  { key: 'challan_no', label: 'Delivery Challan Ref', section: 'transport', type: 'text', defaultVisible: false, source: 'invoice' },
  { key: 'reverse_charge', label: 'Reverse Charge Applicable? (Y/N)', section: 'transport', type: 'select', options: ['NO', 'YES'], defaultVisible: true, source: 'invoice' },
  { key: 'eway_bill_no', label: 'E-Way Bill No', section: 'transport', type: 'text', defaultVisible: true, source: 'invoice' },
  { key: 'salesperson_name', label: 'Salesperson / Agent Name', section: 'transport', type: 'text', defaultVisible: false, source: 'invoice' },

  /* ===== BILL TO ===== */
  { key: 'party_name', label: 'Party Name', section: 'billto', type: 'text', defaultVisible: true, source: 'party' },
  { key: 'party_gstin', label: 'Party GSTIN', section: 'billto', type: 'text', defaultVisible: true, source: 'party' },
  { key: 'party_state', label: 'Party State + Code', section: 'billto', type: 'select', options: 'states', defaultVisible: true, source: 'party' },
  { key: 'party_contact', label: 'Party Contact No', section: 'billto', type: 'text', defaultVisible: true, source: 'party' },
  { key: 'billing_address', label: 'Billing Address', section: 'billto', type: 'textarea', defaultVisible: true, source: 'party' },

  /* ===== SHIP TO ===== */
  { key: 'shipping_address', label: 'Ship To — Address', section: 'shipto', type: 'textarea', defaultVisible: true, source: 'invoice' },
  { key: 'shipping_name', label: 'Ship To — Name', section: 'shipto', type: 'text', defaultVisible: false, source: 'invoice' },
  { key: 'shipping_gstin', label: 'Ship To — GSTIN', section: 'shipto', type: 'text', defaultVisible: false, source: 'invoice' },
  { key: 'shipping_state', label: 'Ship To — State + Code', section: 'shipto', type: 'select', options: 'states', defaultVisible: false, source: 'invoice' },
  { key: 'shipping_contact', label: 'Ship To — Contact', section: 'shipto', type: 'text', defaultVisible: false, source: 'invoice' },

  /* ===== ITEMS ===== */
  { key: 'item_sno', label: 'S.No. column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_desc', label: 'Description of Goods/Services', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_hsn', label: 'HSN/SAC Code column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_qty', label: 'Qty column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_unit', label: 'Unit (kg/pcs/meter) column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_weight', label: 'Weight column (kg)', section: 'items', type: 'boolean', defaultVisible: false },
  { key: 'item_rate', label: 'Rate per Unit column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_discount', label: 'Discount % / ₹ column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_taxable', label: 'Taxable Value column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_gst', label: 'GST Rate % column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_cgst', label: 'CGST Amount column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_sgst', label: 'SGST Amount column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_igst', label: 'IGST Amount column', section: 'items', type: 'boolean', defaultVisible: true },
  { key: 'item_total', label: 'Total Amount (per line)', section: 'items', type: 'boolean', defaultVisible: true },

  /* ===== PAYMENT / FOOTER ===== */
  { key: 'total_before_tax', label: 'Total Before Tax (Taxable Value)', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'total_discount', label: 'Total Discount', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'freight_charges', label: 'Freight Charges', section: 'payment', type: 'number', defaultVisible: true, source: 'invoice' },
  { key: 'packing_charges', label: 'Packing Charges', section: 'payment', type: 'number', defaultVisible: false, source: 'invoice' },
  { key: 'insurance_charges', label: 'Insurance Charges', section: 'payment', type: 'number', defaultVisible: false, source: 'invoice' },
  { key: 'cgst_total', label: 'CGST @ X% — Amount', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'sgst_total', label: 'SGST @ X% — Amount', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'igst_total', label: 'IGST @ X% — Amount', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'round_off', label: 'Round Off (+/-)', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'grand_total', label: 'Grand Total / Total After Tax', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'amount_in_words', label: 'Total Amount in Words', section: 'payment', type: 'boolean', defaultVisible: true },
  { key: 'bank_details', label: 'Bank Details (Name/Branch/A/C/IFSC)', section: 'payment', type: 'boolean', defaultVisible: true, source: 'company' },
  { key: 'upi_qr', label: 'UPI ID / QR Code', section: 'payment', type: 'boolean', defaultVisible: true, source: 'company' },
  { key: 'payment_terms', label: 'Payment Terms (Net 15/30, COD, Advance)', section: 'payment', type: 'select', options: 'paymentTerms', defaultVisible: true, source: 'invoice' },
  { key: 'payment_status', label: 'Payment Status (Paid/Unpaid/Partial)', section: 'payment', type: 'select', options: ['UNPAID', 'PARTIAL', 'PAID'], defaultVisible: true, source: 'invoice' },

  /* ===== LEGAL ===== */
  { key: 'terms_conditions', label: 'Terms & Conditions', section: 'legal', type: 'boolean', defaultVisible: true },
  { key: 'jurisdiction', label: 'Jurisdiction Clause', section: 'legal', type: 'text', defaultVisible: true, source: 'company' },
  { key: 'certified_clause', label: '\u201cCertified true and correct\u201d', section: 'legal', type: 'boolean', defaultVisible: true },
  { key: 'eoe', label: 'E. & O.E. (Errors & Omissions)', section: 'legal', type: 'boolean', defaultVisible: true },

  /* ===== SIGNATURE ===== */
  { key: 'signatory_name', label: 'Authorized Signatory Name', section: 'signature', type: 'text', defaultVisible: true, source: 'invoice' },
  { key: 'signature_space', label: 'Signature Space + Stamp/Seal', section: 'signature', type: 'boolean', defaultVisible: true },

  /* ===== E-INVOICE / ADVANCED ===== */
  { key: 'irn_no', label: 'IRN (E-Invoice Ref No)', section: 'einvoice', type: 'text', defaultVisible: false, source: 'invoice' },
  { key: 'ack_no', label: 'Acknowledgement No', section: 'einvoice', type: 'text', defaultVisible: false, source: 'invoice' },
  { key: 'ack_date', label: 'Acknowledgement Date', section: 'einvoice', type: 'date', defaultVisible: false, source: 'invoice' },
  { key: 'einvoice_qr', label: 'E-Invoice QR Code (IRN)', section: 'einvoice', type: 'boolean', defaultVisible: false },
  { key: 'ledger_balance', label: 'Customer Ledger Balance / Previous Due', section: 'einvoice', type: 'boolean', defaultVisible: false },
];

/* ---- Default visible keys (company template initial state) ---- */
export function defaultVisibleKeys() {
  return ALL_FIELDS.filter(f => f.defaultVisible).map(f => f.key);
}

/* ---- Custom field definition limits ---- */
export const CUSTOM_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'textarea', label: 'Multi-line Text' },
];

/* ---- Parse stored custom_fields JSON (array of {key,label,type,value,section}).
       Accepts either a JSON string or an already-parsed array. ---- */
export function parseCustomFields(str) {
  if (Array.isArray(str)) return str;
  if (!str) return [];
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr)) return arr;
  } catch (e) {}
  return [];
}

/* ---- Parse company field_defaults JSON (array of visible keys) ---- */
export function parseFieldDefaults(str) {
  if (!str) return null;
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (e) {}
  return null;
}