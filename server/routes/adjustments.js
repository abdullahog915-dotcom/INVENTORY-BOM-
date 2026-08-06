import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction } from '../ledger.js';

const router = Router();

const OUT_TYPES = new Set(['ADJUSTMENT_OUT', 'SCRAP_OUT', 'PRODUCTION_CONSUMPTION_OUT', 'SALES_OUT', 'JOB_WORK_SENT_OUT']);

router.post('/', (req, res) => {
  const { item_id, txn_type, qty, rate, txn_date, remarks } = req.body;
  if (!item_id) return res.status(400).json({ error: 'item_id required' });
  const allowed = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SCRAP_OUT'];
  if (!allowed.includes(txn_type)) return res.status(400).json({ error: `Adjustment supports only ${allowed.join(', ')}` });
  if (!(Number(qty) > 0)) return res.status(400).json({ error: 'qty must be > 0' });

  const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(item_id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (OUT_TYPES.has(txn_type) && item.current_stock_qty < Number(qty)) {
    return res.status(400).json({ error: `Insufficient stock: available ${item.current_stock_qty} ${item.unit}` });
  }

  try {
    const ledgerId = postStockTransaction({
      item_id,
      txn_type,
      qty: Number(qty),
      rate: rate === undefined || rate === null || rate === '' ? undefined : Number(rate),
      reference_type: 'MANUAL',
      txn_date: txn_date || now(),
      remarks: remarks || 'Manual adjustment',
    });
    res.status(201).json({ ledger_id: ledgerId, ...db.prepare('SELECT * FROM items WHERE item_id=?').get(item_id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT sl.*, i.sku, i.item_name, i.unit
      FROM stock_ledger sl JOIN items i ON i.item_id=sl.item_id
      WHERE sl.txn_type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT','SCRAP_OUT') AND sl.reference_type='MANUAL' AND sl.company_id=?
      ORDER BY sl.ledger_id DESC LIMIT 200`).all(req.companyId);
  res.json(rows);
});

export default router;
