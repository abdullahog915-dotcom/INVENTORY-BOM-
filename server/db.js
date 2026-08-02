import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'craft-erp.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED_GOOD','SCRAP')),
  category TEXT,
  unit TEXT NOT NULL,
  hsn_code TEXT,
  reorder_level REAL DEFAULT 0,
  current_stock_qty REAL DEFAULT 0,
  avg_cost_rate REAL DEFAULT 0,
  current_stock_value REAL DEFAULT 0,
  last_purchase_rate REAL DEFAULT 0,
  sale_rate REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bom_headers (
  bom_id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_item_id INTEGER NOT NULL REFERENCES items(item_id),
  output_qty REAL NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  labor_cost REAL DEFAULT 0,
  overhead_pct REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bom_lines (
  bom_line_id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES bom_headers(bom_id),
  component_item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty_required REAL NOT NULL,
  wastage_pct REAL DEFAULT 0,
  unit_cost_snapshot REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS production_orders (
  prod_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  bom_id INTEGER NOT NULL REFERENCES bom_headers(bom_id),
  output_item_id INTEGER NOT NULL REFERENCES items(item_id),
  planned_qty REAL NOT NULL,
  completed_qty REAL DEFAULT 0,
  status TEXT DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  est_material_cost REAL DEFAULT 0,
  est_labor_cost REAL DEFAULT 0,
  est_overhead_value REAL DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  actual_material_cost REAL DEFAULT 0,
  actual_labor_cost REAL DEFAULT 0,
  actual_overhead_value REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  scrap_qty REAL DEFAULT 0,
  scrap_value REAL DEFAULT 0,
  order_date TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_date TEXT,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS production_consumption (
  consumption_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_order_id INTEGER NOT NULL REFERENCES production_orders(prod_order_id),
  component_item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty_planned REAL NOT NULL,
  qty_actual REAL NOT NULL,
  rate_at_consumption REAL NOT NULL,
  value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS production_scrap (
  scrap_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_order_id INTEGER NOT NULL REFERENCES production_orders(prod_order_id),
  scrap_item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty REAL NOT NULL,
  rate REAL NOT NULL,
  value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_ledger (
  ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  txn_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  txn_type TEXT NOT NULL CHECK(txn_type IN (
    'PURCHASE_IN','PRODUCTION_OUTPUT_IN','PRODUCTION_CONSUMPTION_OUT',
    'SALES_OUT','SALES_RETURN_IN',
    'SCRAP_IN','SCRAP_OUT',
    'JOB_WORK_SENT_OUT','JOB_WORK_RECEIVED_IN',
    'ADJUSTMENT_IN','ADJUSTMENT_OUT'
  )),
  qty REAL NOT NULL,
  rate REAL NOT NULL,
  value REAL NOT NULL,
  balance_qty REAL NOT NULL,
  balance_value REAL NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  vendor_type TEXT DEFAULT 'SUPPLIER' CHECK(vendor_type IN ('SUPPLIER','JOB_WORKER','BOTH')),
  contact_no TEXT,
  address TEXT,
  gstin TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no TEXT UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendors(vendor_id),
  po_date TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','PARTIAL','RECEIVED','CANCELLED')),
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  po_line_id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id),
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty_ordered REAL NOT NULL,
  qty_received REAL DEFAULT 0,
  rate REAL NOT NULL,
  gst_pct REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_invoices (
  invoice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  invoice_date TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'POSTED' CHECK(status IN ('POSTED','CANCELLED')),
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  line_id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices(invoice_id),
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty REAL NOT NULL,
  qty_returned REAL DEFAULT 0,
  rate REAL NOT NULL,
  gst_pct REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_returns (
  return_id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices(invoice_id),
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty REAL NOT NULL,
  rate REAL NOT NULL,
  return_date TEXT DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS job_work_orders (
  jw_id INTEGER PRIMARY KEY AUTOINCREMENT,
  jw_no TEXT UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendors(vendor_id),
  item_id INTEGER NOT NULL REFERENCES items(item_id),
  qty_sent REAL NOT NULL,
  qty_received REAL DEFAULT 0,
  job_charges REAL DEFAULT 0,
  status TEXT DEFAULT 'SENT' CHECK(status IN ('SENT','PARTIAL_RECEIVED','RECEIVED','CANCELLED')),
  sent_date TEXT DEFAULT CURRENT_TIMESTAMP,
  received_date TEXT,
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_item ON stock_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON stock_ledger(txn_date);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON stock_ledger(txn_type);
CREATE INDEX IF NOT EXISTS idx_bom_active ON bom_headers(output_item_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pol_po ON purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_sil_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_consumption_order ON production_consumption(prod_order_id);
`);

export const LEDGER_IN_TYPES = new Set([
  'PURCHASE_IN', 'PRODUCTION_OUTPUT_IN', 'SALES_RETURN_IN',
  'SCRAP_IN', 'JOB_WORK_RECEIVED_IN', 'ADJUSTMENT_IN',
]);

export const LEDGER_TXN_LABELS = {
  PURCHASE_IN: 'Purchase IN / खरीद आगमन',
  PRODUCTION_OUTPUT_IN: 'Production Output IN / उत्पादन आगमन',
  PRODUCTION_CONSUMPTION_OUT: 'Production Consumption OUT / उत्पादन उपभोग',
  SALES_OUT: 'Sales OUT / बिक्री निकास',
  SALES_RETURN_IN: 'Sales Return IN / वापसी आगमन',
  SCRAP_IN: 'Scrap IN / स्क्रैप आगमन',
  SCRAP_OUT: 'Scrap OUT / स्क्रैप निकास',
  JOB_WORK_SENT_OUT: 'Job Work Sent OUT / जॉब वर्क भेजा',
  JOB_WORK_RECEIVED_IN: 'Job Work Received IN / जॉब वर्क प्राप्त',
  ADJUSTMENT_IN: 'Adjustment IN / समायोजन',
  ADJUSTMENT_OUT: 'Adjustment OUT / समायोजन',
};

export function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
