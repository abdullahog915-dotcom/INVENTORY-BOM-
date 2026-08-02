import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../ledger.js';

const router = Router();

router.get('/', (req, res) => {
  const inventory = db.prepare(`SELECT COALESCE(SUM(current_stock_value),0) total_value,
      COALESCE(SUM(current_stock_qty),0) total_qty,
      COUNT(*) item_count FROM items WHERE is_active=1`).get();

  const byType = db.prepare(`SELECT item_type, COUNT(*) cnt,
      COALESCE(SUM(current_stock_value),0) value FROM items WHERE is_active=1
      GROUP BY item_type`).all();

  const lowStock = db.prepare(`SELECT item_id, sku, item_name, unit, reorder_level, current_stock_qty
      FROM items WHERE is_active=1 AND reorder_level > 0 AND current_stock_qty <= reorder_level
      ORDER BY (current_stock_qty - reorder_level) ASC LIMIT 10`).all();

  const pendingProduction = db.prepare(`SELECT COUNT(*) cnt, COALESCE(SUM(planned_qty - completed_qty),0) pending_qty
      FROM production_orders WHERE status IN ('PLANNED','IN_PROGRESS')`).get();

  const pendingJobWork = db.prepare(`SELECT COUNT(*) cnt, COALESCE(SUM(qty_sent - qty_received),0) pending_qty
      FROM job_work_orders WHERE status IN ('SENT','PARTIAL_RECEIVED')`).get();

  const pendingPurchase = db.prepare(`SELECT COUNT(*) cnt, COALESCE(SUM(l.qty_ordered - l.qty_received),0) pending_qty
      FROM purchase_order_lines l JOIN purchase_orders p ON p.po_id=l.po_id
      WHERE p.status IN ('PENDING','PARTIAL')`).get();

  const recentTxns = db.prepare(`SELECT sl.*, i.sku, i.item_name FROM stock_ledger sl
      JOIN items i ON i.item_id=sl.item_id ORDER BY sl.ledger_id DESC LIMIT 12`).all();

  const topStock = db.prepare(`SELECT sku, item_name, current_stock_qty, current_stock_value, unit
      FROM items WHERE is_active=1 ORDER BY current_stock_value DESC LIMIT 5`).all();

  res.json({
    inventory: { total_value: round2(inventory.total_value), total_qty: round2(inventory.total_qty), item_count: inventory.item_count },
    by_type: byType.map(r => ({ ...r, value: round2(r.value) })),
    low_stock: { count: lowStock.length, items: lowStock },
    pending_production: pendingProduction,
    pending_job_work: pendingJobWork,
    pending_purchase: pendingPurchase,
    recent_transactions: recentTxns,
    top_stock: topStock.map(r => ({ ...r, current_stock_value: round2(r.current_stock_value) })),
  });
});

export default router;
