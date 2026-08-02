import { Router } from 'express';
import { db } from '../db.js';
import { LEDGER_TXN_LABELS } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { item_id = '', from = '', to = '', type = '', search = '' } = req.query;
  let sql = `SELECT sl.*, i.sku, i.item_name, i.item_type, i.unit, i.category
             FROM stock_ledger sl JOIN items i ON i.item_id=sl.item_id WHERE sl.company_id=?`;
  const params = [req.companyId];
  if (item_id) { sql += ` AND sl.item_id=?`; params.push(item_id); }
  if (from) { sql += ` AND date(sl.txn_date) >= date(?)`; params.push(from); }
  if (to) { sql += ` AND date(sl.txn_date) <= date(?)`; params.push(to); }
  if (type) { sql += ` AND sl.txn_type=?`; params.push(type); }
  if (search) { sql += ` AND (sl.remarks LIKE ? OR sl.reference_type LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY sl.txn_date, sl.ledger_id`;
  const rows = db.prepare(sql).all(...params);

  const itemMeta = item_id ? db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(item_id, req.companyId) : null;
  let opening = { qty: 0, value: 0 };
  if (itemMeta) {
    const o = db.prepare(`SELECT balance_qty, balance_value FROM stock_ledger
        WHERE item_id=? AND date(txn_date) < date(?) ORDER BY ledger_id DESC LIMIT 1`)
      .get(item_id, from || '9999-12-31');
    opening = { qty: o?.balance_qty || 0, value: o?.balance_value || 0 };
  }

  res.json({ opening, transactions: rows, txn_labels: LEDGER_TXN_LABELS });
});

router.get('/types', (req, res) => {
  res.json(LEDGER_TXN_LABELS);
});

export default router;
