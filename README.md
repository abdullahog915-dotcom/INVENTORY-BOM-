# Craft ERP — Inventory Management Tool with Multi-Level BOM

A complete, single-project ERP for a handicraft manufacturing business
(brass / aluminium / iron / ceramic lamps & decor items). Indian MSME oriented —
Hindi/English mixed labels, GST fields, weighted-average costing, full stock
ledger and Excel/CSV export on every report.

**Run locally with:** `npm install && npm start` → opens at `http://localhost:3001`

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18 + Tailwind CSS 4 (single-file components, Vite build) |
| Backend | Node.js + Express |
| Database | SQLite via `better-sqlite3` (single file: `data/craft-erp.db`) |

Node.js >= 18 recommended.

## Quick Start

```bash
npm install
npm start          # builds frontend, seeds demo data, starts server on :3001
```

- `npm run dev` — Vite dev server (5173) + API (3001) with proxy.
- `npm run db:seed` — (re)seed demo data into an empty database.
- Demo data is seeded automatically on first start; delete/move `data/craft-erp.db`
  and restart to get a fresh copy.

## Modules

1. **Item Master** — SKU auto-generation, type (Raw Material / Semi-Finished /
   Finished Good / Scrap), category, unit, HSN, reorder level, stock, purchase &
   sale rate. Search + filter by type/category.
2. **Multi-Level BOM** — components with qty + wastage % (casting loss), labor,
   overhead %, **version history** (editing creates v+1, never overwrites).
   Nested BOMs (a semi-finished item's BOM can contain other semi-finished
   items) are exploded recursively down to raw materials.
3. **Production Orders** — plan from BOM, auto-calculated raw material
   requirements, **Check Stock Availability** (shows shortfall), **Complete
   Production** with actual consumption + actual scrap entry, partial
   completion (planned 100 / completed 80).
4. **Stock Ledger** — every stock movement logged with date, item, transaction
   type, qty, rate, value, reference, remarks and **running balance**.
5. **Purchase** — Purchase Order + Purchase Entry (stock IN), vendor master with
   rate history, GST on lines (costing uses net rate).
6. **Scrap / Wastage** — scrap generated in production booked to its own scrap
   item (SCRAP IN) at scrap rate; disposal via Scrap OUT; reported separately.
7. **Job Work Tracker** — send material out (polishing/electroplating), receive
   back with job charges, pending job work tracking.
8. **Sales** — invoice (stock OUT) with GST, sales returns (stock IN), invoice
   cancel (reverses stock), gross profit per invoice.

## Reports (all with date range + Export to Excel/CSV)

- **A. Stock Valuation Report** — per item: Opening, Purchase IN, Production
  IN, Sales Return IN, Other IN, Consumption OUT, Sales OUT, Scrap OUT,
  Job Work OUT, Other OUT, Closing (qty + value). Weighted Average Cost
  recalculation on every IN. Subtotals by item type + grand total.
- **B. Scrap Valuation Report** — scrap generated vs disposed, separately from
  finished goods.
- **C. BOM Cost vs Actual Cost (Variance)** — estimated (from BOM) vs actual
  (real consumption + wastage) per production order, variance % highlighted.
- **D. Raw Material Consumption Report** — item-wise quantity/value consumed.
- **E. Low Stock / Reorder Report** — items at/below reorder level with
  suggested purchase quantity.
- **F. Stock Ledger** — item-wise detailed transaction history.

## Database Schema

Tables (see `server/db.js` for the executable DDL):

```
items              item_id, sku, item_name, item_type, category, unit, hsn_code,
                   reorder_level, current_stock_qty, avg_cost_rate, current_stock_value,
                   last_purchase_rate, sale_rate, is_active
bom_headers        bom_id, output_item_id→items, output_qty, version, labor_cost,
                   overhead_pct, is_active, notes
bom_lines          bom_line_id, bom_id→bom_headers, component_item_id→items,
                   qty_required, wastage_pct, unit_cost_snapshot
production_orders  prod_order_id, order_no, bom_id→bom_headers, output_item_id→items,
                   planned_qty, completed_qty, status, est/actual cost fields,
                   scrap_qty, scrap_value, order_date, completed_date, remarks
production_consumption  consumption_id, prod_order_id, component_item_id,
                   qty_planned, qty_actual, rate_at_consumption, value
production_scrap   scrap_id, prod_order_id, scrap_item_id, qty, rate, value
stock_ledger       ledger_id, item_id→items, txn_date, txn_type, qty, rate, value,
                   balance_qty, balance_value, reference_type, reference_id, remarks
vendors            vendor_id, vendor_name, vendor_type(SUPPLIER/JOB_WORKER/BOTH),
                   contact_no, address, gstin
purchase_orders    po_id, po_no, vendor_id, po_date, status, remarks
purchase_order_lines  po_line_id, po_id, item_id, qty_ordered, qty_received, rate, gst_pct
sales_invoices     invoice_id, invoice_no, customer_name, invoice_date, status, remarks
sales_invoice_lines  line_id, invoice_id, item_id, qty, qty_returned, rate, gst_pct
sales_returns      return_id, invoice_id, item_id, qty, rate, return_date, remarks
job_work_orders    jw_id, jw_no, vendor_id, item_id, qty_sent, qty_received,
                   job_charges, status, sent_date, received_date, remarks
```

### Stock ledger transaction types

`PURCHASE_IN`, `PRODUCTION_OUTPUT_IN`, `PRODUCTION_CONSUMPTION_OUT`,
`SALES_OUT`, `SALES_RETURN_IN`, `SCRAP_IN`, `SCRAP_OUT`,
`JOB_WORK_SENT_OUT`, `JOB_WORK_RECEIVED_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`.

### Weighted Average Costing

On every IN entry:

```
new_avg_rate = (existing_qty × existing_avg_rate + incoming_qty × incoming_rate)
               / (existing_qty + incoming_qty)
```

On every OUT entry, value is charged at the current average rate. `avg_cost_rate`
lives on `items` and is recalculated by the single entry point
`postStockTransaction()` in `server/ledger.js` — every module writes through it,
so the ledger, item stock and valuation reports can never diverge.

## Project Layout

```
server/
  index.js            Express app (API + serves built frontend)
  db.js               SQLite schema + connection
  ledger.js           postStockTransaction() — WAC + running balance
  costing.js          BOM cost + nested raw-material explosion
  seed.js             demo data
  routes/             items, bom, production, purchase, sales, jobwork,
                      adjustments, ledger, reports, dashboard
client/
  vite.config.js      dev proxy /api → :3001, allowedHosts for preview
  src/
    App.jsx           shell + navigation
    components/       ui, DataTable, ExportCSV, DateRange
    pages/            Dashboard, Items, Vendors, BOM, Production, Purchase,
                      Sales, JobWork, Adjustments, Ledger, Reports
```
