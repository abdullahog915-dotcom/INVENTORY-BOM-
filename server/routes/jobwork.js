import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction, round2 } from '../ledger.js';

const router = Router();

function nextJwNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT jw_no FROM job_work_orders ORDER BY jw_id DESC LIMIT 1').get();
  let seq = 1;
  if (row) {
    const m = row.jw_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `JW-${year}-${String(seq).padStart(4, '0')}`;
}

const JW_SELECT = `SELECT j.*, v.vendor_name, i.sku, i.item_name, i.unit
  FROM job_work_orders j
  LEFT JOIN vendors v ON v.vendor_id=j.vendor_id
  JOIN items i ON i.item_id=j.item_id`;

router.get('/jobwork', (req, res) => {
  const { pending_only = '0', status = '', search = '' } = req.query;
  let sql = JW_SELECT + ` WHERE 1=1`;
  const params = [];
  if (pending_only === '1') { sql += ` AND j.status IN ('SENT','PARTIAL_RECEIVED')`; }
  if (status) { sql += ` AND j.status=?`; params.push(status); }
  if (search) { sql += ` AND (j.jw_no LIKE ? OR i.item_name LIKE ? OR v.vendor_name LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ` ORDER BY j.jw_id DESC LIMIT 300`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/jobwork/:id', (req, res) => {
  const jw = db.prepare(JW_SELECT + ` WHERE j.jw_id=?`).get(req.params.id);
  if (!jw) return res.status(404).json({ error: 'Job work order not found' });
  res.json(jw);
});

router.post('/jobwork', (req, res) => {
  const { vendor_id, item_id, qty_sent, job_charges, sent_date, remarks } = req.body;
  if (!item_id || !(Number(qty_sent) > 0)) return res.status(400).json({ error: 'item_id and qty_sent > 0 required' });
  const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(item_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.current_stock_qty < Number(qty_sent)) {
    return res.status(400).json({ error: `Insufficient stock: available ${item.current_stock_qty} ${item.unit}, sending ${qty_sent}` });
  }

  const tx = db.transaction(() => {
    const jwNo = nextJwNo();
    const info = db.prepare(`INSERT INTO job_work_orders
        (jw_no, vendor_id, item_id, qty_sent, job_charges, status, sent_date, remarks)
        VALUES (?,?,?,?,?, 'SENT', ?, ?)`)
      .run(jwNo, vendor_id || null, item_id, Number(qty_sent), Number(job_charges) || 0,
        sent_date || now(), remarks || null);
    postStockTransaction({
      item_id,
      txn_type: 'JOB_WORK_SENT_OUT',
      qty: Number(qty_sent),
      reference_type: 'JOB_WORK',
      reference_id: info.lastInsertRowid,
      txn_date: sent_date || now(),
      remarks: `Sent for job work ${jwNo}`,
    });
    return info.lastInsertRowid;
  });

  try {
    const jwId = tx();
    res.status(201).json(db.prepare(JW_SELECT + ` WHERE j.jw_id=?`).get(jwId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jobwork/:id/receive', (req, res) => {
  const jw = db.prepare('SELECT * FROM job_work_orders WHERE jw_id=?').get(req.params.id);
  if (!jw) return res.status(404).json({ error: 'Job work order not found' });
  if (jw.status === 'RECEIVED') return res.status(400).json({ error: 'Already fully received' });
  if (jw.status === 'CANCELLED') return res.status(400).json({ error: 'Order is cancelled' });

  const receiveQty = Number(req.body.qty_received);
  if (!(receiveQty > 0)) return res.status(400).json({ error: 'qty_received must be > 0' });
  if (jw.qty_received + receiveQty > jw.qty_sent) {
    return res.status(400).json({ error: `Receive exceeds sent qty (sent ${jw.qty_sent}, already received ${jw.qty_received})` });
  }

  const tx = db.transaction(() => {
    postStockTransaction({
      item_id: jw.item_id,
      txn_type: 'JOB_WORK_RECEIVED_IN',
      qty: receiveQty,
      reference_type: 'JOB_WORK',
      reference_id: jw.jw_id,
      txn_date: req.body.received_date || now(),
      remarks: `Received back from job work ${jw.jw_no}`,
    });
    const newReceived = round2(jw.qty_received + receiveQty);
    const status = newReceived >= jw.qty_sent ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    db.prepare(`UPDATE job_work_orders SET qty_received=?, job_charges=?, status=?, received_date=?
        WHERE jw_id=?`)
      .run(newReceived, Number(req.body.job_charges) || jw.job_charges, status,
        status === 'RECEIVED' ? (req.body.received_date || now()) : jw.received_date, jw.jw_id);
  });

  try {
    tx();
    res.json(db.prepare(JW_SELECT + ` WHERE j.jw_id=?`).get(jw.jw_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jobwork/:id/cancel', (req, res) => {
  const jw = db.prepare('SELECT * FROM job_work_orders WHERE jw_id=?').get(req.params.id);
  if (!jw) return res.status(404).json({ error: 'Job work order not found' });
  if (jw.qty_received > 0) return res.status(400).json({ error: 'Cannot cancel after partial receipt' });

  const tx = db.transaction(() => {
    postStockTransaction({
      item_id: jw.item_id,
      txn_type: 'ADJUSTMENT_IN',
      qty: jw.qty_sent,
      reference_type: 'JOB_WORK',
      reference_id: jw.jw_id,
      remarks: `Reverse of cancelled job work ${jw.jw_no}`,
    });
    db.prepare(`UPDATE job_work_orders SET status='CANCELLED' WHERE jw_id=?`).run(jw.jw_id);
  });
  tx();
  res.json({ ok: true });
});

export default router;
