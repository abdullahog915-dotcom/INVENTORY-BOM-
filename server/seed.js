import { db, now, getDefaultCompanyId } from './db.js';
import { postStockTransaction, round2 } from './ledger.js';
import { explodeBom, estimateProductionCost } from './costing.js';
import { computeLine, computeTotals, isSameState } from './invoice.js';

function companyState(companyId) {
  const c = db.prepare('SELECT state FROM companies WHERE company_id=?').get(companyId);
  return c?.state || '';
}

function addItem(companyId, sku, item_name, item_type, category, grp, unit, hsn_code, gst_pct, reorder_level, sale_rate = 0) {
  return db.prepare(`INSERT INTO items
    (company_id, sku, item_name, item_type, category, grp, unit, hsn_code, gst_pct, reorder_level, sale_rate, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`).run(companyId, sku, item_name, item_type, category, grp, unit, hsn_code, gst_pct, reorder_level, sale_rate).lastInsertRowid;
}

function addVendor(companyId, name, type, contact, gstin, state = 'UP') {
  return db.prepare(`INSERT INTO vendors (company_id, vendor_name, vendor_type, contact_no, address, gstin, state)
    VALUES (?,?,?,?,?,?,?)`).run(companyId, name, type, contact, 'Demo Address, Moradabad, UP', gstin, state).lastInsertRowid;
}

function addCustomer(companyId, name, state, gstin, contact = '', address = 'Demo Address, Moradabad, UP') {
  return db.prepare(`INSERT INTO customers (company_id, customer_name, billing_address, gstin, state, contact_no)
    VALUES (?,?,?,?,?,?)`).run(companyId, name, address, gstin, state, contact).lastInsertRowid;
}

function createBom(companyId, outputItemId, outputQty, labor, overheadPct, notes, lines) {
  const info = db.prepare(`INSERT INTO bom_headers
    (company_id, output_item_id, output_qty, version, labor_cost, overhead_pct, is_active, notes)
    VALUES (?,?,?,1,?,?,1,?)`).run(companyId, outputItemId, outputQty, labor, overheadPct, notes);
  const bomId = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO bom_lines (bom_id, component_item_id, qty_required, wastage_pct, unit_cost_snapshot)
    VALUES (?,?,?,?,?)`);
  for (const [compId, qty, wastage] of lines) {
    const comp = db.prepare('SELECT avg_cost_rate FROM items WHERE item_id=?').get(compId);
    ins.run(bomId, compId, qty, wastage, round2(comp.avg_cost_rate));
  }
  return bomId;
}

function createAndReceivePO(companyId, vendorId, date, lines) {
  const state = db.prepare('SELECT state FROM vendors WHERE vendor_id=?').get(vendorId).state;
  const same = isSameState(state, companyState(companyId));
  const seq = db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c + 1;
  const poInfo = db.prepare(`INSERT INTO purchase_orders (company_id, po_no, vendor_id, po_date, status, remarks)
    VALUES (?,?,?,?,'RECEIVED', 'Seed data')`).run(companyId, `PO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`, vendorId, date);
  const poId = poInfo.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO purchase_order_lines
    (po_id, item_id, qty_ordered, qty_received, rate, gst_pct, hsn_code, unit, discount_pct,
     taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [itemId, qty, rate, gst] of lines) {
    const it = db.prepare('SELECT * FROM items WHERE item_id=?').get(itemId);
    const calc = computeLine({ rate, qty, gst_pct: gst, discount_pct: 0 }, same);
    ins.run(poId, itemId, qty, qty, rate, gst, it.hsn_code, it.unit, 0,
      calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total);
    postStockTransaction({
      item_id: itemId, txn_type: 'PURCHASE_IN', qty, rate,
      reference_type: 'PURCHASE_ORDER', reference_id: poId,
      txn_date: date, remarks: 'Opening stock purchase',
    });
  }
  return poId;
}

function completeProduction(companyId, outputItemId, plannedQty, completedQty, date, scrapLines = [], overrides = {}) {
  const bom = db.prepare(`SELECT * FROM bom_headers WHERE output_item_id=? AND is_active=1`).get(outputItemId);
  const seq = db.prepare('SELECT COUNT(*) c FROM production_orders').get().c + 1;
  const orderInfo = db.prepare(`INSERT INTO production_orders
    (company_id, order_no, bom_id, output_item_id, planned_qty, status, order_date)
    VALUES (?,?,?,?,?,'COMPLETED',?)`).run(
      companyId, `PO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
      bom.bom_id, outputItemId, plannedQty, date);
  const orderId = orderInfo.lastInsertRowid;

  const requirements = [...explodeBom(outputItemId, completedQty).values()];
  const insCons = db.prepare(`INSERT INTO production_consumption
    (prod_order_id, component_item_id, qty_planned, qty_actual, rate_at_consumption, value) VALUES (?,?,?,?,?,?)`);
  let materialCost = 0;
  for (const req of requirements) {
    postStockTransaction({
      item_id: req.item.item_id, txn_type: 'PRODUCTION_CONSUMPTION_OUT', qty: req.qty,
      reference_type: 'PRODUCTION_ORDER', reference_id: orderId,
      txn_date: date, remarks: 'Seed production consumption',
    });
    const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(req.item.item_id);
    const rate = round2(item.avg_cost_rate);
    materialCost += req.qty * rate;
    insCons.run(orderId, req.item.item_id, req.qty, req.qty, rate, round2(req.qty * rate));
  }
  materialCost = round2(materialCost);

  const labor = overrides.labor ?? round2((bom.labor_cost || 0) * completedQty / (bom.output_qty || 1));
  const overheadPct = overrides.overheadPct ?? (bom.overhead_pct || 0);
  const overhead = round2((materialCost + labor) * overheadPct / 100);
  const actualCost = round2(materialCost + labor + overhead);

  const insScrap = db.prepare(`INSERT INTO production_scrap (prod_order_id, scrap_item_id, qty, rate, value)
    VALUES (?,?,?,?,?)`);
  let scrapQty = 0, scrapValue = 0;
  for (const [scrapItemId, qty, rate] of scrapLines) {
    postStockTransaction({
      item_id: scrapItemId, txn_type: 'SCRAP_IN', qty, rate,
      reference_type: 'PRODUCTION_ORDER', reference_id: orderId,
      txn_date: date, remarks: 'Seed production scrap',
    });
    scrapQty += qty;
    scrapValue += qty * rate;
    insScrap.run(orderId, scrapItemId, qty, rate, round2(qty * rate));
  }

  postStockTransaction({
    item_id: outputItemId, txn_type: 'PRODUCTION_OUTPUT_IN', qty: completedQty, rate: round2(actualCost / completedQty),
    reference_type: 'PRODUCTION_ORDER', reference_id: orderId,
    txn_date: date, remarks: 'Seed production output',
  });

  db.prepare(`UPDATE production_orders SET
    completed_qty=?, completed_date=?, est_material_cost=?, est_labor_cost=?, est_overhead_value=?, estimated_cost=?,
    actual_material_cost=?, actual_labor_cost=?, actual_overhead_value=?, actual_cost=?,
    scrap_qty=?, scrap_value=? WHERE prod_order_id=?`)
    .run(completedQty, date,
      round2(materialCost), labor, overhead, round2(materialCost + labor + overhead),
      materialCost, labor, overhead, actualCost,
      round2(scrapQty), round2(scrapValue), orderId);
  return orderId;
}

function createSales(companyId, customer, date, lines) {
  const seq = db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c + 1;
  let cust = null;
  let custName = '';
  let custId = null;
  if (typeof customer === 'object') {
    cust = customer;
    custName = customer.customer_name;
    custId = customer.customer_id;
  } else if (typeof customer === 'number') {
    cust = db.prepare('SELECT * FROM customers WHERE customer_id=? AND company_id=?').get(customer, companyId);
    custName = cust?.customer_name || '';
    custId = customer;
  } else {
    cust = db.prepare('SELECT * FROM customers WHERE customer_name=? AND company_id=?').get(customer, companyId);
    custName = customer;
    custId = cust?.customer_id || null;
  }
  const state = cust?.state || companyState(companyId);
  const same = isSameState(state, companyState(companyId));
  const invInfo = db.prepare(`INSERT INTO sales_invoices
    (company_id, invoice_no, customer_id, customer_name, customer_state, invoice_date, status, stock_posted, terms_conditions, remarks)
    VALUES (?,?,?,?,?,?,'SENT',1,NULL,'Seed data')`).run(
      companyId, `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
      custId, custName, state, date);
  const invId = invInfo.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO sales_invoice_lines
    (invoice_id, item_id, qty, qty_returned, rate, gst_pct, hsn_code, unit, discount_pct,
     taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
    VALUES (?,?,?,0,?,?,?,?,0,?,?,?,?,?)`);
  for (const [itemId, qty, rate, gst] of lines) {
    const it = db.prepare('SELECT * FROM items WHERE item_id=?').get(itemId);
    const calc = computeLine({ rate, qty, gst_pct: gst, discount_pct: 0 }, same);
    ins.run(invId, itemId, qty, rate, gst, it.hsn_code, it.unit,
      calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total);
    postStockTransaction({
      item_id: itemId, txn_type: 'SALES_OUT', qty,
      reference_type: 'SALES_INVOICE', reference_id: invId,
      txn_date: date, remarks: 'Seed sale',
    });
  }
  return invId;
}

function seedCompanyData(companyId) {
  console.log(`Seeding demo data for company #${companyId}...`);
  const tx = db.transaction(() => {
    /* ---- Items ---- */
    const brassIngot = addItem(companyId, 'RM-BRASS-001', 'Brass Ingot', 'RAW_MATERIAL', 'Brass', 'Metals', 'kg', '7403', 18, 100);
    const aluIngot = addItem(companyId, 'RM-ALU-001', 'Aluminium Ingot', 'RAW_MATERIAL', 'Aluminium', 'Metals', 'kg', '7601', 18, 80);
    const ironSheet = addItem(companyId, 'RM-IRON-001', 'Iron Sheet', 'RAW_MATERIAL', 'Iron', 'Metals', 'kg', '7208', 18, 60);
    const clay = addItem(companyId, 'RM-CERAMIC-001', 'Ceramic Clay', 'RAW_MATERIAL', 'Ceramic', 'Raw Materials', 'kg', '2508', 5, 150);
    const wire = addItem(companyId, 'RM-WIRE-001', 'Copper Wire', 'RAW_MATERIAL', 'Wiring', 'Raw Materials', 'meter', '7408', 18, 50);
    const cotton = addItem(companyId, 'RM-COTTON-001', 'Cotton Cloth', 'RAW_MATERIAL', 'Fabric', 'Raw Materials', 'meter', '5208', 5, 40);
    const polish = addItem(companyId, 'RM-POLISH-001', 'Metal Polish Compound', 'RAW_MATERIAL', 'Finishing', 'Consumables', 'kg', '3405', 18, 10);
    const box = addItem(companyId, 'RM-BOX-001', 'Packing Box', 'RAW_MATERIAL', 'Packing', 'Consumables', 'pcs', '4819', 18, 100);

    const body = addItem(companyId, 'SF-BODY-001', 'Brass Lamp Body', 'SEMI_FINISHED', 'Brass', 'Components', 'pcs', '', 18, 20);
    const shade = addItem(companyId, 'SF-SHADE-001', 'Ceramic Shade', 'SEMI_FINISHED', 'Ceramic', 'Components', 'pcs', '', 5, 20);
    const base = addItem(companyId, 'SF-BASE-001', 'Iron Lamp Base', 'SEMI_FINISHED', 'Iron', 'Components', 'pcs', '', 18, 15);
    const aluBody = addItem(companyId, 'SF-ALU-001', 'Aluminium Lamp Body', 'SEMI_FINISHED', 'Aluminium', 'Components', 'pcs', '', 18, 15);

    const lamp1 = addItem(companyId, 'FG-LAMP-001', 'Brass Table Lamp', 'FINISHED_GOOD', 'Lamps', 'Finished Goods', 'pcs', '9405', 18, 10, 2400);
    const lamp2 = addItem(companyId, 'FG-LAMP-002', 'Aluminium Hanging Lamp', 'FINISHED_GOOD', 'Lamps', 'Finished Goods', 'pcs', '9405', 18, 10, 1800);
    const holder = addItem(companyId, 'FG-DECOR-001', 'Brass Candle Holder', 'FINISHED_GOOD', 'Decor', 'Finished Goods', 'pcs', '9405', 18, 15, 650);

    const brassScrap = addItem(companyId, 'SC-BRASS-001', 'Brass Scrap', 'SCRAP', 'Brass', 'Scrap', 'kg', '7404', 18, 0, 380);
    const aluScrap = addItem(companyId, 'SC-ALU-001', 'Aluminium Scrap', 'SCRAP', 'Aluminium', 'Scrap', 'kg', '7602', 18, 0, 140);
    const ironScrap = addItem(companyId, 'SC-IRON-001', 'Iron Scrap', 'SCRAP', 'Iron', 'Scrap', 'kg', '7204', 18, 0, 30);

    /* ---- Vendors ---- */
    const vSharma = addVendor(companyId, 'Sharma Metal Traders', 'SUPPLIER', '98123 45678', '09AABCS1234F1Z5');
    const vAlok = addVendor(companyId, 'Alok Castings & Alloys', 'SUPPLIER', '98234 56789', '09AACDE5678G1Z6');
    const vRaj = addVendor(companyId, 'Raj Polishing Works', 'JOB_WORKER', '98345 67890', '09AAEFG9012H1Z7');
    const vGupta = addVendor(companyId, 'Gupta Electroplating', 'JOB_WORKER', '98456 78901', '09AAHIJ3456J1Z8');

    /* ---- Customers ---- */
    const cAnita = addCustomer(companyId, 'Anita Decor House', 'Uttar Pradesh', '09BZCPM4256G1Z3', '98970 11223', '14 Civil Lines, Bareilly, UP');
    const cGoyal = addCustomer(companyId, 'Goyal Gift Emporium', 'Uttar Pradesh', '09AXGPS5847K1Z8', '98734 55678', '27 Hazratganj, Lucknow, UP');
    addCustomer(companyId, 'Mumbai Home Concepts', 'Maharashtra', '27AAJHM8899L1Z1', '98200 33445', '45 Linking Road, Bandra West, Mumbai');
    addCustomer(companyId, 'Delhi Artisans & Crafts', 'Delhi', '07AADCA2233M1Z2', '98110 77889', '310 Daryaganj, Delhi');
    addCustomer(companyId, 'Jaipur Craft Exports', 'Rajasthan', '08AAJCE6677N1Z4', '98290 11223', '12 Amber Road, Jaipur');

    /* ---- BOMs ---- */
    createBom(companyId, body, 1, 60, 10, 'Brass casting', [[brassIngot, 0.8, 5]]);
    createBom(companyId, shade, 1, 40, 8, 'Ceramic firing', [[clay, 1.2, 8]]);
    createBom(companyId, base, 1, 35, 8, 'Iron sheet forming', [[ironSheet, 0.9, 4]]);
    createBom(companyId, aluBody, 1, 50, 10, 'Aluminium casting', [[aluIngot, 1.1, 10]]);
    createBom(companyId, lamp1, 1, 150, 12, 'Assembly with nested semi-finished parts',
      [[body, 1, 0], [shade, 1, 0], [wire, 1.5, 0], [cotton, 0.3, 0], [polish, 0.05, 0], [box, 1, 0]]);
    createBom(companyId, lamp2, 1, 100, 10, 'Assembly',
      [[aluBody, 1, 0], [wire, 2, 0], [box, 1, 0]]);
    createBom(companyId, holder, 1, 40, 10, 'Direct brass casting',
      [[brassIngot, 0.35, 6], [polish, 0.02, 0], [box, 1, 0]]);

    /* ---- Purchases (opening stock) ---- */
    createAndReceivePO(companyId, vSharma, '2026-06-01 10:00:00', [
      [brassIngot, 500, 420, 18], [aluIngot, 300, 215, 18], [wire, 300, 32, 18],
    ]);
    createAndReceivePO(companyId, vAlok, '2026-06-03 10:00:00', [
      [ironSheet, 250, 78, 18], [clay, 600, 14, 5], [polish, 40, 185, 18],
    ]);
    createAndReceivePO(companyId, vSharma, '2026-06-05 10:00:00', [
      [box, 600, 8.5, 18], [cotton, 120, 26, 5], [brassIngot, 200, 425, 18],
    ]);

    /* ---- Production (semi-finished) ---- */
    completeProduction(companyId, body, 150, 150, '2026-06-08 09:00:00', [[brassScrap, 4.2, 380]]);
    completeProduction(companyId, shade, 180, 180, '2026-06-09 09:00:00', []);
    completeProduction(companyId, base, 80, 80, '2026-06-10 09:00:00', [[ironScrap, 2.2, 30]]);
    completeProduction(companyId, aluBody, 120, 120, '2026-06-11 09:00:00', [[aluScrap, 9.2, 140]]);

    /* ---- Production (finished goods) ---- */
    completeProduction(companyId, lamp1, 80, 80, '2026-06-15 09:00:00', [[brassScrap, 2.2, 380]]);
    completeProduction(companyId, lamp2, 60, 60, '2026-06-16 09:00:00', [[aluScrap, 4.6, 140]]);
    completeProduction(companyId, holder, 100, 100, '2026-06-17 09:00:00', [[brassScrap, 1.5, 380]]);
    completeProduction(companyId, lamp1, 50, 40, '2026-06-25 09:00:00', [[brassScrap, 1.1, 380]], { remarks: 'Partial completion demo (40 of 50)' });

    /* ---- Sales ---- */
    const inv1 = createSales(companyId, cAnita, '2026-06-20 11:00:00', [
      [lamp1, 20, 2400, 18], [holder, 40, 650, 18],
    ]);
    createSales(companyId, cGoyal, '2026-06-22 11:00:00', [
      [lamp2, 15, 1800, 18],
    ]);
    /* Inter-state demo sales */
    createSales(companyId, 'Mumbai Home Concepts', '2026-06-23 11:00:00', [
      [lamp1, 10, 2400, 18],
    ]);
    createSales(companyId, 'Jaipur Craft Exports', '2026-06-26 11:00:00', [
      [holder, 25, 650, 18],
    ]);

    /* Sales return: 2 pcs of lamp1 on inv1 */
    const line1 = db.prepare('SELECT line_id FROM sales_invoice_lines WHERE invoice_id=? AND item_id=?').get(inv1, lamp1);
    postStockTransaction({
      item_id: lamp1, txn_type: 'SALES_RETURN_IN', qty: 2,
      reference_type: 'SALES_INVOICE', reference_id: inv1,
      txn_date: '2026-06-24 12:00:00', remarks: 'Customer return (defective shade)',
    });
    db.prepare('UPDATE sales_invoice_lines SET qty_returned=2 WHERE line_id=?').run(line1.line_id);
    db.prepare(`INSERT INTO sales_returns (company_id, invoice_id, item_id, qty, rate, return_date, remarks)
      VALUES (?,?,?,?,?,?,'Defective shade')`).run(companyId, inv1, lamp1, 2, 2400, '2026-06-24 12:00:00');

    /* ---- Job Work ---- */
    db.prepare(`INSERT INTO job_work_orders (company_id, jw_no, vendor_id, item_id, qty_sent, qty_received, job_charges, status, sent_date, received_date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        companyId, 'JW-2026-0001', vRaj, body, 50, 50, 400, 'RECEIVED', '2026-06-18 10:00:00', '2026-06-19 16:00:00');
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_SENT_OUT', qty: 50,
      reference_type: 'JOB_WORK', reference_id: 1, txn_date: '2026-06-18 10:00:00', remarks: 'Polishing',
    });
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_RECEIVED_IN', qty: 50,
      reference_type: 'JOB_WORK', reference_id: 1, txn_date: '2026-06-19 16:00:00', remarks: 'Polished received',
    });

    const jw2 = db.prepare(`INSERT INTO job_work_orders (company_id, jw_no, vendor_id, item_id, qty_sent, qty_received, job_charges, status, sent_date)
      VALUES (?,?,?,?,?,0,?, 'SENT', ?)`).run(
        companyId, 'JW-2026-0002', vGupta, body, 30, 240, '2026-06-26 10:00:00').lastInsertRowid;
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_SENT_OUT', qty: 30,
      reference_type: 'JOB_WORK', reference_id: jw2, txn_date: '2026-06-26 10:00:00', remarks: 'Electroplating',
    });

    /* A second-rate purchase to demonstrate WAC movement on brass */
    createAndReceivePO(companyId, vSharma, '2026-06-28 10:00:00', [[brassIngot, 150, 430, 18]]);
  });

  tx();
}

export function seedCompany(companyId) {
  const count = db.prepare('SELECT COUNT(*) c FROM items WHERE company_id=?').get(companyId).c;
  if (count > 0) {
    console.log(`Company #${companyId} already has data, skipping seed.`);
    return;
  }
  seedCompanyData(companyId);
  const v = db.prepare(`SELECT COALESCE(SUM(current_stock_value),0) v FROM items WHERE company_id=?`).get(companyId).v;
  console.log(`Demo data seeded for company #${companyId}. Inventory value: ₹${round2(v)}`);
}

export function ensureSeed() {
  const defaultId = getDefaultCompanyId();
  if (!defaultId) return;
  const count = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  if (count > 0) return;
  seedCompany(defaultId);
}

// CLI mode: `node server/seed.js`
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  ensureSeed();
  db.close();
}
