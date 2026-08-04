import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../ledger.js';

const router = Router();

const TYPE_ORDER = { RAW_MATERIAL: 0, SEMI_FINISHED: 1, FINISHED_GOOD: 2, SCRAP: 3 };
const TYPE_LABEL = {
  RAW_MATERIAL: 'Raw Material',
  SEMI_FINISHED: 'Semi-Finished',
  FINISHED_GOOD: 'Finished Good',
  SCRAP: 'Scrap',
};

/* ---------- A. Stock Valuation Report ---------- */
router.get('/stock-valuation', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  const items = db.prepare(`SELECT i.item_id, i.sku, i.item_name, i.item_type, i.unit, i.category,
      (SELECT sl.balance_qty FROM stock_ledger sl WHERE sl.item_id=i.item_id AND date(sl.txn_date) < date(?)
        ORDER BY sl.ledger_id DESC LIMIT 1) AS op_qty,
      (SELECT sl.balance_value FROM stock_ledger sl WHERE sl.item_id=i.item_id AND date(sl.txn_date) < date(?)
        ORDER BY sl.ledger_id DESC LIMIT 1) AS op_value
      FROM items i WHERE i.is_active=1 AND i.company_id=?`).all(from, from, req.companyId);

  const txnStmt = db.prepare(`SELECT item_id, txn_type, SUM(qty) qty, SUM(value) value
      FROM stock_ledger WHERE company_id=? AND date(txn_date) BETWEEN date(?) AND date(?)
      GROUP BY item_id, txn_type`);
  const sums = txnStmt.all(req.companyId, from, to);
  const sumByItem = new Map();
  for (const s of sums) {
    if (!sumByItem.has(s.item_id)) sumByItem.set(s.item_id, {});
    sumByItem.get(s.item_id)[s.txn_type] = { qty: round2(s.qty), value: round2(s.value) };
  }

  const TYPE_IN = ['PURCHASE_IN', 'PRODUCTION_OUTPUT_IN', 'SALES_RETURN_IN'];
  const TYPE_OUT = ['PRODUCTION_CONSUMPTION_OUT', 'SALES_OUT', 'SCRAP_OUT', 'JOB_WORK_SENT_OUT'];

  const reportItems = [];
  for (const it of items) {
    const m = sumByItem.get(it.item_id) || {};
    const pick = (types, field) => types.reduce((s, t) => s + ((m[t] || {})[field] || 0), 0);
    const totalInQty = TYPE_IN.reduce((s, t) => s + (m[t]?.qty || 0), 0);
    const totalInValue = TYPE_IN.reduce((s, t) => s + (m[t]?.value || 0), 0);
    const totalOutQty = TYPE_OUT.reduce((s, t) => s + (m[t]?.qty || 0), 0);
    const totalOutValue = TYPE_OUT.reduce((s, t) => s + (m[t]?.value || 0), 0);
    const opQty = round2(it.op_qty || 0);
    const opValue = round2(it.op_value || 0);
    const inQty = round2(totalInQty + (m.ADJUSTMENT_IN?.qty || 0) + (m.JOB_WORK_RECEIVED_IN?.qty || 0) + (m.SCRAP_IN?.qty || 0));
    const inValue = round2(totalInValue + (m.ADJUSTMENT_IN?.value || 0) + (m.JOB_WORK_RECEIVED_IN?.value || 0) + (m.SCRAP_IN?.value || 0));
    const outQty = round2(totalOutQty + (m.ADJUSTMENT_OUT?.qty || 0));
    const outValue = round2(totalOutValue + (m.ADJUSTMENT_OUT?.value || 0));
    reportItems.push({
      item_id: it.item_id, sku: it.sku, item_name: it.item_name, item_type: it.item_type,
      unit: it.unit, category: it.category,
      opening: { qty: opQty, value: opValue },
      purchase_in: { qty: round2(m.PURCHASE_IN?.qty || 0), value: round2(m.PURCHASE_IN?.value || 0) },
      production_in: { qty: round2(m.PRODUCTION_OUTPUT_IN?.qty || 0), value: round2(m.PRODUCTION_OUTPUT_IN?.value || 0) },
      sales_return_in: { qty: round2(m.SALES_RETURN_IN?.qty || 0), value: round2(m.SALES_RETURN_IN?.value || 0) },
      other_in: { qty: round2((m.ADJUSTMENT_IN?.qty || 0) + (m.JOB_WORK_RECEIVED_IN?.qty || 0) + (m.SCRAP_IN?.qty || 0)),
                  value: round2((m.ADJUSTMENT_IN?.value || 0) + (m.JOB_WORK_RECEIVED_IN?.value || 0) + (m.SCRAP_IN?.value || 0)) },
      consumption_out: { qty: round2(m.PRODUCTION_CONSUMPTION_OUT?.qty || 0), value: round2(m.PRODUCTION_CONSUMPTION_OUT?.value || 0) },
      sales_out: { qty: round2(m.SALES_OUT?.qty || 0), value: round2(m.SALES_OUT?.value || 0) },
      scrap_out: { qty: round2(m.SCRAP_OUT?.qty || 0), value: round2(m.SCRAP_OUT?.value || 0) },
      jobwork_out: { qty: round2(m.JOB_WORK_SENT_OUT?.qty || 0), value: round2(m.JOB_WORK_SENT_OUT?.value || 0) },
      other_out: { qty: round2(m.ADJUSTMENT_OUT?.qty || 0), value: round2(m.ADJUSTMENT_OUT?.value || 0) },
      total_in: { qty: inQty, value: inValue },
      total_out: { qty: outQty, value: outValue },
      closing: { qty: round2(opQty + inQty - outQty), value: round2(opValue + inValue - outValue) },
    });
  }

  reportItems.sort((a, b) => (TYPE_ORDER[a.item_type] - TYPE_ORDER[b.item_type]) || a.sku.localeCompare(b.sku));

  const subtotals = {};
  const grand = { qty: 0, value: 0 };
  for (const r of reportItems) {
    if (!subtotals[r.item_type]) {
      subtotals[r.item_type] = { opening: { qty: 0, value: 0 }, total_in: { qty: 0, value: 0 },
        total_out: { qty: 0, value: 0 }, closing: { qty: 0, value: 0 } };
    }
    const s = subtotals[r.item_type];
    s.opening.qty += r.opening.qty; s.opening.value += r.opening.value;
    s.total_in.qty += r.total_in.qty; s.total_in.value += r.total_in.value;
    s.total_out.qty += r.total_out.qty; s.total_out.value += r.total_out.value;
    s.closing.qty += r.closing.qty; s.closing.value += r.closing.value;
    grand.qty += r.closing.qty; grand.value += r.closing.value;
  }
  for (const k of Object.keys(subtotals)) {
    const s = subtotals[k];
    for (const f of ['opening', 'total_in', 'total_out', 'closing']) { s[f].qty = round2(s[f].qty); s[f].value = round2(s[f].value); }
  }

  res.json({ from, to, items: reportItems, subtotals, grand_total: { qty: round2(grand.qty), value: round2(grand.value) }, type_label: TYPE_LABEL });
});

/* ---------- B. Scrap Valuation Report ---------- */
router.get('/scrap', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const rows = db.prepare(`SELECT i.item_id, i.sku, i.item_name, i.unit, i.avg_cost_rate, i.sale_rate,
      (SELECT sl.balance_qty FROM stock_ledger sl WHERE sl.item_id=i.item_id AND date(sl.txn_date) < date(?)
        ORDER BY sl.ledger_id DESC LIMIT 1) AS op_qty,
      (SELECT sl.balance_value FROM stock_ledger sl WHERE sl.item_id=i.item_id AND date(sl.txn_date) < date(?)
        ORDER BY sl.ledger_id DESC LIMIT 1) AS op_value
      FROM items i WHERE i.item_type='SCRAP' AND i.is_active=1 AND i.company_id=?`).all(from, from, req.companyId);

  const txnStmt = db.prepare(`SELECT item_id, txn_type, SUM(qty) qty, SUM(value) value
      FROM stock_ledger WHERE company_id=? AND date(txn_date) BETWEEN date(?) AND date(?)
        AND txn_type IN ('SCRAP_IN','SCRAP_OUT','SALES_OUT','ADJUSTMENT_OUT','ADJUSTMENT_IN','SALES_RETURN_IN')
      GROUP BY item_id, txn_type`);
  const sums = txnStmt.all(req.companyId, from, to);
  const sumByItem = new Map();
  for (const s of sums) {
    if (!sumByItem.has(s.item_id)) sumByItem.set(s.item_id, {});
    sumByItem.get(s.item_id)[s.txn_type] = { qty: round2(s.qty), value: round2(s.value) };
  }

  const items = rows.map(it => {
    const m = sumByItem.get(it.item_id) || {};
    const opQty = round2(it.op_qty || 0), opValue = round2(it.op_value || 0);
    const genQty = round2(m.SCRAP_IN?.qty || 0), genValue = round2(m.SCRAP_IN?.value || 0);
    const dispQty = round2((m.SCRAP_OUT?.qty || 0) + (m.SALES_OUT?.qty || 0) + (m.ADJUSTMENT_OUT?.qty || 0));
    const dispValue = round2((m.SCRAP_OUT?.value || 0) + (m.SALES_OUT?.value || 0) + (m.ADJUSTMENT_OUT?.value || 0));
    return {
      item_id: it.item_id, sku: it.sku, item_name: it.item_name, unit: it.unit,
      avg_rate: round2(it.avg_cost_rate), sale_rate: round2(it.sale_rate),
      opening: { qty: opQty, value: opValue },
      generated: { qty: genQty, value: genValue },
      disposed: { qty: dispQty, value: dispValue },
      closing: { qty: round2(opQty + genQty - dispQty), value: round2(opValue + genValue - dispValue) },
    };
  });
  const total = items.reduce((t, r) => ({ qty: round2(t.qty + r.closing.qty), value: round2(t.value + r.closing.value) }), { qty: 0, value: 0 });
  res.json({ from, to, items, total });
});

/* ---------- C. BOM Cost vs Actual Production Cost Variance ---------- */
router.get('/variance', (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT po.*, oi.sku AS output_sku, oi.item_name AS output_name, oi.unit
      FROM production_orders po JOIN items oi ON oi.item_id=po.output_item_id
      WHERE po.status='COMPLETED' AND po.company_id=?`;
  const params = [req.companyId];
  if (from && to) { sql += ` AND date(po.completed_date) BETWEEN date(?) AND date(?)`; params.push(from, to); }
  sql += ` ORDER BY po.prod_order_id DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  const items = rows.map(po => {
    const scale = po.planned_qty > 0 ? round2(po.completed_qty / po.planned_qty) : 0;
    const estScaled = round2(po.estimated_cost * scale);
    const variance = round2(po.actual_cost - estScaled);
    const variancePct = estScaled > 0 ? round2((variance / estScaled) * 100) : 0;
    return {
      prod_order_id: po.prod_order_id, order_no: po.order_no, completed_date: po.completed_date,
      output_sku: po.output_sku, output_name: po.output_name, unit: po.unit,
      planned_qty: po.planned_qty, completed_qty: po.completed_qty,
      est_material: po.est_material_cost, est_labor: po.est_labor_cost, est_overhead: po.est_overhead_value,
      estimated_cost: po.estimated_cost, est_scaled: estScaled,
      actual_material: po.actual_material_cost, actual_labor: po.actual_labor_cost, actual_overhead: po.actual_overhead_value,
      actual_cost: po.actual_cost,
      variance, variance_pct: variancePct, over_budget: variance > 0,
    };
  });
  const summary = items.reduce((t, r) => ({
    estimated: round2(t.estimated + r.est_scaled),
    actual: round2(t.actual + r.actual_cost),
    variance: round2(t.variance + r.variance),
  }), { estimated: 0, actual: 0, variance: 0 });
  res.json({ from, to, items, summary });
});

/* ---------- D. Raw Material Consumption Report ---------- */
router.get('/consumption', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const rows = db.prepare(`SELECT i.item_id, i.sku, i.item_name, i.item_type, i.unit,
      COUNT(DISTINCT sl.reference_id) AS orders_consumed,
      SUM(sl.qty) AS total_qty, SUM(sl.value) AS total_value
      FROM stock_ledger sl JOIN items i ON i.item_id=sl.item_id
      WHERE sl.txn_type='PRODUCTION_CONSUMPTION_OUT' AND sl.company_id=?
        AND date(sl.txn_date) BETWEEN date(?) AND date(?)
      GROUP BY i.item_id ORDER BY i.item_type, total_qty DESC`).all(req.companyId, from, to);
  const total = rows.reduce((t, r) => ({ qty: round2(t.qty + r.total_qty), value: round2(t.value + r.total_value) }), { qty: 0, value: 0 });
  res.json({ from, to, items: rows.map(r => ({ ...r, total_qty: round2(r.total_qty), total_value: round2(r.total_value) })), total });
});

/* ---------- E. Low Stock / Reorder Report ---------- */
router.get('/low-stock', (req, res) => {
  const rows = db.prepare(`SELECT item_id, sku, item_name, item_type, category, unit, reorder_level,
      current_stock_qty, current_stock_value, last_purchase_rate, sale_rate
      FROM items WHERE is_active=1 AND company_id=? AND reorder_level > 0 AND current_stock_qty <= reorder_level
      ORDER BY (current_stock_qty - reorder_level) ASC`).all(req.companyId);
  res.json(rows.map(r => ({
    ...r,
    suggested_qty: round2(Math.max(0, r.reorder_level * 2 - r.current_stock_qty)),
    shortage_qty: round2(r.reorder_level - r.current_stock_qty),
  })));
});

export { TYPE_LABEL };
export default router;
