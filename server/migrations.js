import { db, now, getDefaultCompanyId } from './db.js';
import { computeLine, isSameState } from './invoice.js';

function columns(table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name);
}

function has(table, col) {
  return columns(table).includes(col);
}

function addCol(table, col, ddl) {
  if (!has(table, col)) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${ddl}`);
}

function ensureDefaultCompany() {
  const existing = getDefaultCompanyId();
  if (existing) return existing;
  const info = db.prepare(`INSERT INTO companies
    (name, address, gstin, state, bank_details, invoice_terms, is_default)
    VALUES (?,?,?,?,?,?,1)`)
    .run(
      'Demo Company',
      'D-14, Sector 11, Moradabad, Uttar Pradesh 244001',
      '09ABCDE1234F1Z5',
      'UP',
      'Bank: HDFC Bank\nA/C No: 50100123456789\nIFSC: HDFC0001234\nBranch: Moradabad',
      '1. Goods once sold will not be taken back.\n2. Payment due within the agreed credit period.\n3. Goods remain the property of the company until fully paid.\n4. Any dispute subject to Moradabad jurisdiction.',
    );
  return info.lastInsertRowid;
}

const MASTER_TABLES = ['items', 'vendors', 'bom_headers', 'production_orders', 'stock_ledger',
  'purchase_orders', 'sales_invoices', 'sales_returns', 'job_work_orders'];

function rebuildSalesInvoices() {
  if (has('sales_invoices', 'due_date')) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('DROP TABLE IF EXISTS sales_invoices_new');
  db.exec(`
    CREATE TABLE sales_invoices_new (
      invoice_id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(company_id),
      invoice_no TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_gstin TEXT,
      customer_state TEXT,
      billing_address TEXT,
      shipping_address TEXT,
      place_of_supply TEXT,
      invoice_date TEXT DEFAULT CURRENT_TIMESTAMP,
      due_date TEXT,
      payment_terms TEXT,
      po_reference TEXT,
      status TEXT DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PAID','OVERDUE','CANCELLED')),
      stock_posted INTEGER DEFAULT 0,
      terms_conditions TEXT,
      notes TEXT,
      authorized_signatory TEXT,
      remarks TEXT
    );
  `);
  db.prepare(`INSERT INTO sales_invoices_new
      (invoice_id, invoice_no, customer_name, invoice_date, status, remarks)
      SELECT invoice_id, invoice_no, customer_name, invoice_date,
             CASE WHEN status='POSTED' THEN 'SENT' ELSE status END, remarks FROM sales_invoices`).run();
  db.exec('DROP TABLE sales_invoices');
  db.exec('ALTER TABLE sales_invoices_new RENAME TO sales_invoices');
  db.exec('PRAGMA foreign_keys=ON');
}

/* Sales invoices used to keep customer details as free text only. Link every
   existing invoice to a customers record, creating one (case-insensitive by
   name) when it does not already exist in the customers master. */
function backfillCustomersFromInvoices(companyId) {
  if (!has('sales_invoices', 'customer_id')) return;
  const rows = db.prepare(`SELECT customer_name,
        billing_address, shipping_address, customer_gstin AS gstin, customer_state AS state
      FROM sales_invoices WHERE customer_id IS NULL AND customer_name IS NOT NULL
      GROUP BY LOWER(customer_name)`).all();
  if (rows.length === 0) return;
  const find = db.prepare('SELECT customer_id FROM customers WHERE company_id=? AND LOWER(customer_name)=LOWER(?)');
  const ins = db.prepare(`INSERT INTO customers (company_id, customer_name, billing_address, shipping_address, gstin, state)
      VALUES (?,?,?,?,?,?)`);
  const upd = db.prepare('UPDATE sales_invoices SET customer_id=? WHERE company_id=? AND customer_id IS NULL AND LOWER(customer_name)=LOWER(?)');
  for (const r of rows) {
    let c = find.get(companyId, r.customer_name);
    if (!c) {
      const info = ins.run(companyId, r.customer_name, r.billing_address, r.shipping_address, r.gstin, r.state);
      c = { customer_id: info.lastInsertRowid };
    }
    upd.run(c.customer_id, companyId, r.customer_name);
  }
}

function backfillLineTaxes() {
  /* Legacy line rows predating the tax columns have taxable_value=0. Recompute. */
  const salesLines = db.prepare(`
    SELECT l.line_id, l.qty, l.rate, l.gst_pct, l.discount_pct, si.customer_state, c.state AS company_state
    FROM sales_invoice_lines l
    JOIN sales_invoices si ON si.invoice_id=l.invoice_id
    JOIN companies c ON c.company_id=si.company_id
    WHERE l.taxable_value=0 AND l.qty>0 AND l.rate>0`).all();
  for (const l of salesLines) {
    const calc = computeLine(l, isSameState(l.customer_state, l.company_state));
    db.prepare(`UPDATE sales_invoice_lines SET taxable_value=?, cgst_amount=?, sgst_amount=?, igst_amount=?, line_total=?
        WHERE line_id=?`)
      .run(calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total, l.line_id);
  }

  const poLines = db.prepare(`
    SELECT l.po_line_id, l.qty_ordered, l.rate, l.gst_pct, l.discount_pct, v.state AS vendor_state, c.state AS company_state
    FROM purchase_order_lines l
    JOIN purchase_orders p ON p.po_id=l.po_id
    LEFT JOIN vendors v ON v.vendor_id=p.vendor_id
    JOIN companies c ON c.company_id=p.company_id
    WHERE l.taxable_value=0 AND l.qty_ordered>0 AND l.rate>0`).all();
  for (const l of poLines) {
    const calc = computeLine({ qty: l.qty_ordered, rate: l.rate, gst_pct: l.gst_pct, discount_pct: l.discount_pct },
      isSameState(l.vendor_state, l.company_state));
    db.prepare(`UPDATE purchase_order_lines SET taxable_value=?, cgst_amount=?, sgst_amount=?, igst_amount=?, line_total=?
        WHERE po_line_id=?`)
      .run(calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total, l.po_line_id);
  }
}

export function runMigrations() {
  const defaultId = ensureDefaultCompany();

  /* Company Profile extensions */
  addCol('companies', 'phone', 'TEXT');
  addCol('companies', 'email', 'TEXT');
  addCol('companies', 'website', 'TEXT');
  addCol('companies', 'pan', 'TEXT');
  addCol('companies', 'upi_id', 'TEXT');
  addCol('companies', 'jurisdiction', 'TEXT');
  addCol('companies', 'field_defaults', 'TEXT');

  /* Item & Master extensions */
  addCol('items', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('items', 'gst_pct', 'REAL DEFAULT 0');
  addCol('items', 'grp', 'TEXT');
  addCol('groups', 'item_type', "TEXT CHECK(item_type IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOOD','SCRAP'))");

  addCol('vendors', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('vendors', 'state', 'TEXT');

  addCol('bom_headers', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('production_orders', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('stock_ledger', 'company_id', 'INTEGER REFERENCES companies(company_id)');

  /* Purchase Orders extensions */
  addCol('purchase_orders', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('purchase_orders', 'vendor_invoice_no', 'TEXT');
  addCol('purchase_orders', 'due_date', 'TEXT');
  addCol('purchase_orders', 'place_of_supply', 'TEXT');
  addCol('purchase_orders', 'payment_terms', 'TEXT');
  addCol('purchase_orders', 'reference_no', 'TEXT');
  addCol('purchase_orders', 'payment_status', "TEXT DEFAULT 'UNPAID'");
  addCol('purchase_orders', 'amount_paid', 'REAL DEFAULT 0');
  addCol('purchase_orders', 'notes', 'TEXT');
  addCol('purchase_orders', 'transport_mode', 'TEXT');
  addCol('purchase_orders', 'vehicle_no', 'TEXT');
  addCol('purchase_orders', 'delivery_date', 'TEXT');
  addCol('purchase_orders', 'reverse_charge', 'INTEGER DEFAULT 0');
  addCol('purchase_orders', 'eway_bill_no', 'TEXT');
  addCol('purchase_orders', 'order_date', 'TEXT');
  addCol('purchase_orders', 'challan_no', 'TEXT');
  addCol('purchase_orders', 'other_charges', 'REAL DEFAULT 0');
  addCol('purchase_orders', 'custom_fields', 'TEXT');
  addCol('purchase_orders', 'discount_amount', 'REAL DEFAULT 0');
  addCol('purchase_orders', 'freight_charges', 'REAL DEFAULT 0');
  addCol('purchase_orders', 'packing_charges', 'REAL DEFAULT 0');
  addCol('purchase_orders', 'insurance_charges', 'REAL DEFAULT 0');

  /* Sales Invoices extensions */
  addCol('sales_invoices', 'transport_mode', 'TEXT');
  addCol('sales_invoices', 'vehicle_no', 'TEXT');
  addCol('sales_invoices', 'delivery_date', 'TEXT');
  addCol('sales_invoices', 'reverse_charge', 'INTEGER DEFAULT 0');
  addCol('sales_invoices', 'eway_bill_no', 'TEXT');
  addCol('sales_invoices', 'order_date', 'TEXT');
  addCol('sales_invoices', 'challan_no', 'TEXT');
  addCol('sales_invoices', 'salesperson_name', 'TEXT');
  addCol('sales_invoices', 'other_charges', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'amount_paid', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'payment_status', "TEXT DEFAULT 'UNPAID'");
  addCol('sales_invoices', 'copy_type', "TEXT DEFAULT 'Original for Recipient'");
  addCol('sales_invoices', 'irn_no', 'TEXT');
  addCol('sales_invoices', 'ack_no', 'TEXT');
  addCol('sales_invoices', 'ack_date', 'TEXT');
  addCol('sales_invoices', 'custom_fields', 'TEXT');
  addCol('sales_invoices', 'shipping_name', 'TEXT');
  addCol('sales_invoices', 'shipping_gstin', 'TEXT');
  addCol('sales_invoices', 'shipping_state', 'TEXT');
  addCol('sales_invoices', 'shipping_contact', 'TEXT');
  addCol('sales_invoices', 'discount_amount', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'freight_charges', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'packing_charges', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'insurance_charges', 'REAL DEFAULT 0');
  addCol('sales_invoices', 'customer_id', 'INTEGER REFERENCES customers(customer_id)');

  /* Invoice Line extensions */
  for (const t of ['purchase_order_lines', 'sales_invoice_lines']) {
    addCol(t, 'hsn_code', 'TEXT');
    addCol(t, 'unit', 'TEXT');
    addCol(t, 'weight', 'REAL DEFAULT 0');
    addCol(t, 'discount_pct', 'REAL DEFAULT 0');
    addCol(t, 'taxable_value', 'REAL DEFAULT 0');
    addCol(t, 'cgst_amount', 'REAL DEFAULT 0');
    addCol(t, 'sgst_amount', 'REAL DEFAULT 0');
    addCol(t, 'igst_amount', 'REAL DEFAULT 0');
    addCol(t, 'line_total', 'REAL DEFAULT 0');
  }

  addCol('sales_returns', 'company_id', 'INTEGER REFERENCES companies(company_id)');
  addCol('job_work_orders', 'company_id', 'INTEGER REFERENCES companies(company_id)');

  rebuildSalesInvoices();

  /* link sales invoices to the customers master (also creates missing customers) */
  backfillCustomersFromInvoices(defaultId);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_si_customer ON sales_invoices(customer_id);
           CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);`);

  /* backfill company_id on existing rows */
  for (const t of MASTER_TABLES) {
    if (has(t, 'company_id')) {
      db.prepare(`UPDATE "${t}" SET company_id=? WHERE company_id IS NULL`).run(defaultId);
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_company ON stock_ledger(company_id);
           CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);
           CREATE INDEX IF NOT EXISTS idx_po_company ON purchase_orders(company_id);
           CREATE INDEX IF NOT EXISTS idx_si_company ON sales_invoices(company_id);`);

  backfillLineTaxes();
}
