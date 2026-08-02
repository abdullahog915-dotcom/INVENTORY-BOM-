import { Router } from 'express';
import { db, now } from '../db.js';
import { estimateProductionCost, explodeBom, getActiveBom } from '../costing.js';
import { postStockTransaction, round2 } from '../ledger.js';

const router = Router();

function nextOrderNo() {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT order_no FROM production_orders ORDER BY prod_order_id DESC LIMIT 1`).get();
  let seq = 1;
  if (row) {
    const m = row.order_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `PO-${year}-${String(seq).padStart(4, '0')}`;
}

const ORDER_SELECT = `SELECT po.*, oi.sku AS output_sku, oi.item_name AS output_name, oi.unit AS output_unit,
  bh.version AS bom_version, bh.output_qty AS bom_output_qty,
  (SELECT COUNT(*) FROM production_consumption pc WHERE pc.prod_order_id=po.prod_order_id) AS consumption_count,
  (SELECT COUNT(*) FROM production_scrap ps WHERE ps.prod_order_id=po.prod_order_id) AS scrap_count
  FROM production_orders po
  JOIN items oi ON oi.item_id=po.output_item_id
  JOIN bom_headers bh ON bh.bom_id=po.bom_id`;

router.get('/', (req, res) => {
  const { status = '', search = '' } = req.query;
  let sql = ORDER_SELECT + ` WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND po.status=?`; params.push(status); }
  if (search) { sql += ` AND (po.order_no LIKE ? OR oi.item_name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY po.prod_order_id DESC LIMIT 300`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const order = db.prepare(ORDER_SELECT + ` WHERE po.prod_order_id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Production order not found' });
  const consumption = db.prepare(`SELECT pc.*, i.sku, i.item_name, i.unit
    FROM production_consumption pc JOIN items i ON i.item_id=pc.component_item_id
    WHERE pc.prod_order_id=?`).all(order.prod_order_id);
  const scrap = db.prepare(`SELECT ps.*, i.sku, i.item_name, i.unit
    FROM production_scrap ps JOIN items i ON i.item_id=ps.scrap_item_id
    WHERE ps.prod_order_id=?`).all(order.prod_order_id);
  res.json({ ...order, consumption, scrap });
});

router.post('/', (req, res) => {
  const { output_item_id, planned_qty, remarks } = req.body;
  if (!output_item_id || !(Number(planned_qty) > 0)) {
    return res.status(400).json({ error: 'output_item_id and planned_qty > 0 are required' });
  }
  const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(output_item_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const bom = getActiveBom(output_item_id);
  if (!bom) return res.status(400).json({ error: 'No active BOM found for this item' });

  try {
    const est = estimateProductionCost(output_item_id, Number(planned_qty));
    const orderNo = nextOrderNo();
    const info = db.prepare(`INSERT INTO production_orders
      (order_no, bom_id, output_item_id, planned_qty, status,
       est_material_cost, est_labor_cost, est_overhead_value, estimated_cost, remarks)
      VALUES (?,?,?,?,'PLANNED',?,?,?,?,?)`)
      .run(orderNo, bom.bom_id, output_item_id, Number(planned_qty),
        est.materialCost, est.laborCost, est.overheadValue, est.total, remarks || null);
    res.status(201).json(db.prepare(ORDER_SELECT + ` WHERE po.prod_order_id=?`).get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/check-stock', (req, res) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE prod_order_id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Production order not found' });
  try {
    const est = estimateProductionCost(order.output_item_id, order.planned_qty);
    res.json({ requirements: est.requirements, hasShortfall: est.requirements.some(r => r.shortfall > 0) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/complete', (req, res) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE prod_order_id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Production order not found' });
  if (order.status === 'COMPLETED') return res.status(400).json({ error: 'Order already completed' });
  if (order.status === 'CANCELLED') return res.status(400).json({ error: 'Order is cancelled' });

  const completedQty = Number(req.body.completed_qty);
  if (!(completedQty > 0)) return res.status(400).json({ error: 'completed_qty must be > 0' });
  if (completedQty > order.planned_qty) return res.status(400).json({ error: 'completed_qty cannot exceed planned_qty' });

  const bom = db.prepare('SELECT * FROM bom_headers WHERE bom_id=?').get(order.bom_id);
  const requirements = [...explodeBom(order.output_item_id, completedQty).values()];
  const provided = new Map((req.body.consumptions || []).map(c => [c.item_id, Number(c.qty_actual)]));

  const tx = db.transaction(() => {
    let materialCost = 0;
    const insCons = db.prepare(`INSERT INTO production_consumption
      (prod_order_id, component_item_id, qty_planned, qty_actual, rate_at_consumption, value)
      VALUES (?,?,?,?,?,?)`);

    for (const req of requirements) {
      const qtyActual = provided.has(req.item.item_id) ? round2(provided.get(req.item.item_id)) : req.qty;
      if (qtyActual <= 0) continue;
      const item = req.item;
      postStockTransaction({
        item_id: item.item_id,
        txn_type: 'PRODUCTION_CONSUMPTION_OUT',
        qty: qtyActual,
        reference_type: 'PRODUCTION_ORDER',
        reference_id: order.prod_order_id,
        remarks: `Consumed for ${order.order_no}`,
      });
      const item2 = db.prepare('SELECT * FROM items WHERE item_id=?').get(item.item_id);
      const rate = round2(item2.avg_cost_rate);
      const value = round2(qtyActual * rate);
      materialCost += value;
      insCons.run(order.prod_order_id, item.item_id, req.qty, qtyActual, rate, value);
    }
    materialCost = round2(materialCost);

    const bomLabor = round2((bom.labor_cost || 0) * completedQty / (bom.output_qty || 1));
    const actualLabor = Number(req.body.actual_labor_cost) > 0 ? round2(Number(req.body.actual_labor_cost)) : bomLabor;
    const overheadPct = Number(req.body.overhead_pct) > 0 ? Number(req.body.overhead_pct) : (bom.overhead_pct || 0);
    const overheadValue = round2((materialCost + actualLabor) * overheadPct / 100);
    const actualCost = round2(materialCost + actualLabor + overheadValue);

    let scrapQty = 0;
    let scrapValue = 0;
    const insScrap = db.prepare(`INSERT INTO production_scrap
      (prod_order_id, scrap_item_id, qty, rate, value) VALUES (?,?,?,?,?)`);
    for (const s of req.body.scrap || []) {
      const qty = round2(Number(s.qty));
      const rate = round2(Number(s.rate));
      if (qty <= 0) continue;
      const scrapItem = db.prepare('SELECT * FROM items WHERE item_id=?').get(s.item_id);
      if (!scrapItem || scrapItem.item_type !== 'SCRAP') {
        throw new Error('Scrap entries must reference SCRAP type items');
      }
      postStockTransaction({
        item_id: s.item_id,
        txn_type: 'SCRAP_IN',
        qty,
        rate: rate > 0 ? rate : scrapItem.sale_rate || 0,
        reference_type: 'PRODUCTION_ORDER',
        reference_id: order.prod_order_id,
        remarks: `Scrap from ${order.order_no}`,
      });
      const value = round2(qty * (rate > 0 ? rate : scrapItem.sale_rate || 0));
      scrapQty += qty;
      scrapValue += value;
      insScrap.run(order.prod_order_id, s.item_id, qty, rate > 0 ? rate : scrapItem.sale_rate || 0, value);
    }

    const unitCost = completedQty > 0 ? round2(actualCost / completedQty) : 0;
    postStockTransaction({
      item_id: order.output_item_id,
      txn_type: 'PRODUCTION_OUTPUT_IN',
      qty: completedQty,
      rate: unitCost,
      reference_type: 'PRODUCTION_ORDER',
      reference_id: order.prod_order_id,
      remarks: `Production of ${order.order_no}`,
    });

    db.prepare(`UPDATE production_orders SET
        completed_qty=?, status='COMPLETED', completed_date=?,
        actual_material_cost=?, actual_labor_cost=?, actual_overhead_value=?, actual_cost=?,
        scrap_qty=?, scrap_value=?, remarks=?
        WHERE prod_order_id=?`)
      .run(completedQty, now(), materialCost, actualLabor, overheadValue, actualCost,
        round2(scrapQty), round2(scrapValue), req.body.remarks || order.remarks, order.prod_order_id);

    return { completedQty, materialCost, actualLabor, overheadValue, actualCost, scrapQty, scrapValue };
  });

  try {
    const result = tx();
    res.json({ ...result, order: db.prepare(ORDER_SELECT + ` WHERE po.prod_order_id=?`).get(order.prod_order_id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE prod_order_id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Production order not found' });
  if (order.status === 'COMPLETED') return res.status(400).json({ error: 'Cannot cancel a completed order' });
  db.prepare(`UPDATE production_orders SET status='CANCELLED', remarks=? WHERE prod_order_id=?`)
    .run(req.body.remarks || 'Cancelled', order.prod_order_id);
  res.json(db.prepare(ORDER_SELECT + ` WHERE po.prod_order_id=?`).get(order.prod_order_id));
});

export default router;
