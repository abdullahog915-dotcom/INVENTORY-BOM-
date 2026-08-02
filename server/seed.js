import { db, now } from './db.js';
import { postStockTransaction, round2 } from './ledger.js';
import { explodeBom, estimateProductionCost } from './costing.js';

function addItem(sku, item_name, item_type, category, unit, hsn_code, reorder_level, sale_rate = 0) {
  return db.prepare(`INSERT INTO items
    (sku, item_name, item_type, category, unit, hsn_code, reorder_level, sale_rate, is_active)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(sku, item_name, item_type, category, unit, hsn_code, reorder_level, sale_rate).lastInsertRowid;
}

function addVendor(name, type, contact, gstin) {
  return db.prepare(`INSERT INTO vendors (vendor_name, vendor_type, contact_no, address, gstin)
    VALUES (?,?,?,?,?)`).run(name, type, contact, 'Demo Address, Moradabad, UP', gstin).lastInsertRowid;
}

function createBom(outputItemId, outputQty, labor, overheadPct, notes, lines) {
  const info = db.prepare(`INSERT INTO bom_headers
    (output_item_id, output_qty, version, labor_cost, overhead_pct, is_active, notes)
    VALUES (?,?,1,?,?,1,?)`).run(outputItemId, outputQty, labor, overheadPct, notes);
  const bomId = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO bom_lines (bom_id, component_item_id, qty_required, wastage_pct, unit_cost_snapshot)
    VALUES (?,?,?,?,?)`);
  for (const [compId, qty, wastage] of lines) {
    const comp = db.prepare('SELECT avg_cost_rate FROM items WHERE item_id=?').get(compId);
    ins.run(bomId, compId, qty, wastage, round2(comp.avg_cost_rate));
  }
  return bomId;
}

function createAndReceivePO(vendorId, date, lines) {
  const seq = db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c + 1;
  const poInfo = db.prepare(`INSERT INTO purchase_orders (po_no, vendor_id, po_date, status, remarks)
    VALUES (?,?,?,'RECEIVED', 'Seed data')`).run(`PO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`, vendorId, date);
  const poId = poInfo.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO purchase_order_lines (po_id, item_id, qty_ordered, qty_received, rate, gst_pct)
    VALUES (?,?,?,?,?,?)`);
  for (const [itemId, qty, rate, gst] of lines) {
    ins.run(poId, itemId, qty, qty, rate, gst);
    postStockTransaction({
      item_id: itemId, txn_type: 'PURCHASE_IN', qty, rate,
      reference_type: 'PURCHASE_ORDER', reference_id: poId,
      txn_date: date, remarks: 'Opening stock purchase',
    });
  }
  return poId;
}

function completeProduction(outputItemId, plannedQty, completedQty, date, scrapLines = [], overrides = {}) {
  const bom = db.prepare(`SELECT * FROM bom_headers WHERE output_item_id=? AND is_active=1`).get(outputItemId);
  const seq = db.prepare('SELECT COUNT(*) c FROM production_orders').get().c + 1;
  const orderInfo = db.prepare(`INSERT INTO production_orders
    (order_no, bom_id, output_item_id, planned_qty, status, order_date)
    VALUES (?,?,?,?,'COMPLETED',?)`).run(
      `PO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
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

function createSales(customer, date, lines) {
  const seq = db.prepare('SELECT COUNT(*) c FROM sales_invoices').get().c + 1;
  const invInfo = db.prepare(`INSERT INTO sales_invoices (invoice_no, customer_name, invoice_date, status, remarks)
    VALUES (?,?,?,'POSTED','Seed data')`).run(
      `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
      customer, date);
  const invId = invInfo.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO sales_invoice_lines (invoice_id, item_id, qty, qty_returned, rate, gst_pct)
    VALUES (?,?,?,0,?,?)`);
  for (const [itemId, qty, rate, gst] of lines) {
    ins.run(invId, itemId, qty, rate, gst);
    postStockTransaction({
      item_id: itemId, txn_type: 'SALES_OUT', qty,
      reference_type: 'SALES_INVOICE', reference_id: invId,
      txn_date: date, remarks: 'Seed sale',
    });
  }
  return invId;
}

export function ensureSeed() {
  const count = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  if (count > 0) return;

  console.log('Seeding demo data...');
  const tx = db.transaction(() => {
    /* ---- Items ---- */
    const brassIngot = addItem('RM-BRASS-001', 'Brass Ingot (पीतल ढलाई)', 'RAW_MATERIAL', 'Brass', 'kg', '7403', 100);
    const aluIngot = addItem('RM-ALU-001', 'Aluminium Ingot (एल्युमिनियम ढलाई)', 'RAW_MATERIAL', 'Aluminium', 'kg', '7601', 80);
    const ironSheet = addItem('RM-IRON-001', 'Iron Sheet (लोहा शीट)', 'RAW_MATERIAL', 'Iron', 'kg', '7208', 60);
    const clay = addItem('RM-CERAMIC-001', 'Ceramic Clay (सिरेमिक मिट्टी)', 'RAW_MATERIAL', 'Ceramic', 'kg', '2508', 150);
    const wire = addItem('RM-WIRE-001', 'Copper Wire (तांबा तार)', 'RAW_MATERIAL', 'Wiring', 'meter', '7408', 50);
    const cotton = addItem('RM-COTTON-001', 'Cotton Cloth (सूती कपड़ा)', 'RAW_MATERIAL', 'Fabric', 'meter', '5208', 40);
    const polish = addItem('RM-POLISH-001', 'Metal Polish Compound (पॉलिश)', 'RAW_MATERIAL', 'Finishing', 'kg', '3405', 10);
    const box = addItem('RM-BOX-001', 'Packing Box (पैकिंग बॉक्स)', 'RAW_MATERIAL', 'Packing', 'pcs', '4819', 100);

    const body = addItem('SF-BODY-001', 'Brass Lamp Body (पीतल बॉडी)', 'SEMI_FINISHED', 'Brass', 'pcs', '', 20);
    const shade = addItem('SF-SHADE-001', 'Ceramic Shade (सिरेमिक शेड)', 'SEMI_FINISHED', 'Ceramic', 'pcs', '', 20);
    const base = addItem('SF-BASE-001', 'Iron Lamp Base (लोहा बेस)', 'SEMI_FINISHED', 'Iron', 'pcs', '', 15);
    const aluBody = addItem('SF-ALU-001', 'Aluminium Lamp Body (एल्युमिनियम बॉडी)', 'SEMI_FINISHED', 'Aluminium', 'pcs', '', 15);

    const lamp1 = addItem('FG-LAMP-001', 'Brass Table Lamp (पीतल टेबल लैंप)', 'FINISHED_GOOD', 'Lamps', 'pcs', '9405', 10, 2400);
    const lamp2 = addItem('FG-LAMP-002', 'Aluminium Hanging Lamp (एल्युमिनियम लटकन लैंप)', 'FINISHED_GOOD', 'Lamps', 'pcs', '9405', 10, 1800);
    const holder = addItem('FG-DECOR-001', 'Brass Candle Holder (पीतल कैंडल स्टैंड)', 'FINISHED_GOOD', 'Decor', 'pcs', '9405', 15, 650);

    const brassScrap = addItem('SC-BRASS-001', 'Brass Scrap (पीतल स्क्रैप)', 'SCRAP', 'Brass', 'kg', '7404', 0, 380);
    const aluScrap = addItem('SC-ALU-001', 'Aluminium Scrap (एल्युमिनियम स्क्रैप)', 'SCRAP', 'Aluminium', 'kg', '7602', 0, 140);
    const ironScrap = addItem('SC-IRON-001', 'Iron Scrap (लोहा स्क्रैप)', 'SCRAP', 'Iron', 'kg', '7204', 0, 30);

    /* ---- Vendors ---- */
    const vSharma = addVendor('Sharma Metal Traders', 'SUPPLIER', '98123 45678', '09AABCS1234F1Z5');
    const vAlok = addVendor('Alok Castings & Alloys', 'SUPPLIER', '98234 56789', '09AACDE5678G1Z6');
    const vRaj = addVendor('Raj Polishing Works', 'JOB_WORKER', '98345 67890', '09AAEFG9012H1Z7');
    const vGupta = addVendor('Gupta Electroplating', 'JOB_WORKER', '98456 78901', '09AAHIJ3456J1Z8');

    /* ---- BOMs ---- */
    createBom(body, 1, 60, 10, 'Brass casting', [[brassIngot, 0.8, 5]]);
    createBom(shade, 1, 40, 8, 'Ceramic firing', [[clay, 1.2, 8]]);
    createBom(base, 1, 35, 8, 'Iron sheet forming', [[ironSheet, 0.9, 4]]);
    createBom(aluBody, 1, 50, 10, 'Aluminium casting', [[aluIngot, 1.1, 10]]);
    createBom(lamp1, 1, 150, 12, 'Assembly with nested semi-finished parts',
      [[body, 1, 0], [shade, 1, 0], [wire, 1.5, 0], [cotton, 0.3, 0], [polish, 0.05, 0], [box, 1, 0]]);
    createBom(lamp2, 1, 100, 10, 'Assembly',
      [[aluBody, 1, 0], [wire, 2, 0], [box, 1, 0]]);
    createBom(holder, 1, 40, 10, 'Direct brass casting',
      [[brassIngot, 0.35, 6], [polish, 0.02, 0], [box, 1, 0]]);

    /* ---- Purchases (opening stock) ---- */
    createAndReceivePO(vSharma, '2026-06-01 10:00:00', [
      [brassIngot, 500, 420, 18], [aluIngot, 300, 215, 18], [wire, 300, 32, 18],
    ]);
    createAndReceivePO(vAlok, '2026-06-03 10:00:00', [
      [ironSheet, 250, 78, 18], [clay, 600, 14, 5], [polish, 40, 185, 18],
    ]);
    createAndReceivePO(vSharma, '2026-06-05 10:00:00', [
      [box, 600, 8.5, 18], [cotton, 120, 26, 5], [brassIngot, 200, 425, 18],
    ]);

    /* ---- Production (semi-finished) ---- */
    completeProduction(body, 150, 150, '2026-06-08 09:00:00', [[brassScrap, 4.2, 380]]);
    completeProduction(shade, 180, 180, '2026-06-09 09:00:00', []);
    completeProduction(base, 80, 80, '2026-06-10 09:00:00', [[ironScrap, 2.2, 30]]);
    completeProduction(aluBody, 120, 120, '2026-06-11 09:00:00', [[aluScrap, 9.2, 140]]);

    /* ---- Production (finished goods) ---- */
    completeProduction(lamp1, 80, 80, '2026-06-15 09:00:00', [[brassScrap, 2.2, 380]]);
    completeProduction(lamp2, 60, 60, '2026-06-16 09:00:00', [[aluScrap, 4.6, 140]]);
    completeProduction(holder, 100, 100, '2026-06-17 09:00:00', [[brassScrap, 1.5, 380]]);
    completeProduction(lamp1, 50, 40, '2026-06-25 09:00:00', [[brassScrap, 1.1, 380]], { remarks: 'Partial completion demo (40 of 50)' });

    /* ---- Sales ---- */
    const inv1 = createSales('Anita Decor House', '2026-06-20 11:00:00', [
      [lamp1, 20, 2400, 18], [holder, 40, 650, 18],
    ]);
    createSales('Goyal Gift Emporium', '2026-06-22 11:00:00', [
      [lamp2, 15, 1800, 18],
    ]);

    /* Sales return: 2 pcs of lamp1 on inv1 */
    const line1 = db.prepare('SELECT line_id FROM sales_invoice_lines WHERE invoice_id=? AND item_id=?').get(inv1, lamp1);
    postStockTransaction({
      item_id: lamp1, txn_type: 'SALES_RETURN_IN', qty: 2,
      reference_type: 'SALES_INVOICE', reference_id: inv1,
      txn_date: '2026-06-24 12:00:00', remarks: 'Customer return (defective shade)',
    });
    db.prepare('UPDATE sales_invoice_lines SET qty_returned=2 WHERE line_id=?').run(line1.line_id);
    db.prepare(`INSERT INTO sales_returns (invoice_id, item_id, qty, rate, return_date, remarks)
      VALUES (?,?,?,?,?,'Defective shade')`).run(inv1, lamp1, 2, 2400, '2026-06-24 12:00:00');

    /* ---- Job Work ---- */
    db.prepare(`INSERT INTO job_work_orders (jw_no, vendor_id, item_id, qty_sent, qty_received, job_charges, status, sent_date, received_date)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
        'JW-2026-0001', vRaj, body, 50, 50, 400, 'RECEIVED', '2026-06-18 10:00:00', '2026-06-19 16:00:00');
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_SENT_OUT', qty: 50,
      reference_type: 'JOB_WORK', reference_id: 1, txn_date: '2026-06-18 10:00:00', remarks: 'Polishing',
    });
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_RECEIVED_IN', qty: 50,
      reference_type: 'JOB_WORK', reference_id: 1, txn_date: '2026-06-19 16:00:00', remarks: 'Polished received',
    });

    const jw2 = db.prepare(`INSERT INTO job_work_orders (jw_no, vendor_id, item_id, qty_sent, qty_received, job_charges, status, sent_date)
      VALUES (?,?,?,?,0,?, 'SENT', ?)`).run(
        'JW-2026-0002', vGupta, body, 30, 240, '2026-06-26 10:00:00').lastInsertRowid;
    postStockTransaction({
      item_id: body, txn_type: 'JOB_WORK_SENT_OUT', qty: 30,
      reference_type: 'JOB_WORK', reference_id: jw2, txn_date: '2026-06-26 10:00:00', remarks: 'Electroplating',
    });

    /* A second-rate purchase to demonstrate WAC movement on brass */
    createAndReceivePO(vSharma, '2026-06-28 10:00:00', [[brassIngot, 150, 430, 18]]);
  });

  tx();
  console.log('Demo data seeded.');
  console.log(`Inventory value: ₹${round2(db.prepare('SELECT COALESCE(SUM(current_stock_value),0) v FROM items').get().v)}`);
}

// CLI mode: `node server/seed.js`
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  ensureSeed();
  db.close();
}
