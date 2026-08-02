import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction, round2 } from '../ledger.js';

const router = Router();

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT invoice_no FROM sales_invoices ORDER BY invoice_id DESC LIMIT 1').get();
  let seq = 1;
  if (row) {
    const m = row.invoice_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

const INVOICE_SELECT = `SELECT si.*,
  (SELECT COUNT(*) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS line_count,
  (SELECT SUM(l.qty) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS total_qty,
  (SELECT COALESCE(SUM(l.qty * l.rate * (1 + l.gst_pct/100.0)),0) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS invoice_total
  FROM sales_invoices si`;

router.get('/sales', (req, res) => {
  const { search = '' } = req.query;
  let sql = INVOICE_SELECT + ` WHERE 1=1`;
  const params = [];
  if (search) { sql += ` AND (si.invoice_no LIKE ? OR si.customer_name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY si.invoice_id DESC LIMIT 300`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/sales/:id', (req, res) => {
  const inv = db.prepare(INVOICE_SELECT + ` WHERE si.invoice_id=?`).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const lines = db.prepare(`SELECT l.*, i.sku, i.item_name, i.unit, i.avg_cost_rate
      FROM sales_invoice_lines l JOIN items i ON i.item_id=l.item_id WHERE l.invoice_id=?`).all(inv.invoice_id);
  const returns = db.prepare(`SELECT r.*, i.sku, i.item_name FROM sales_returns r
      JOIN items i ON i.item_id=r.item_id WHERE r.invoice_id=? ORDER BY r.return_id DESC`).all(inv.invoice_id);
  const taxable = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const gst = lines.reduce((s, l) => s + l.qty * l.rate * l.gst_pct / 100, 0);
  const cogs = lines.reduce((s, l) => s + l.qty * l.avg_cost_rate, 0);
  res.json({ ...inv, lines, returns, taxable_value: round2(taxable), gst_value: round2(gst),
    total_value: round2(taxable + gst), cogs_value: round2(cogs), gross_profit: round2(taxable - cogs) });
});

router.post('/sales', (req, res) => {
  const { customer_name, invoice_date, remarks, lines } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'customer_name required' });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Invoice needs at least one line' });

  const tx = db.transaction(() => {
    for (const l of lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.item_id);
      if (!item) throw new Error(`Item #${l.item_id} not found`);
      if (Number(l.qty) <= 0) throw new Error(`Line for ${item.sku} needs qty > 0`);
      if (item.current_stock_qty < Number(l.qty)) {
        throw new Error(`Insufficient stock for ${item.sku}: available ${item.current_stock_qty} ${item.unit}, selling ${l.qty}`);
      }
    }
    const invoiceNo = nextInvoiceNo();
    const info = db.prepare(`INSERT INTO sales_invoices (invoice_no, customer_name, invoice_date, status, remarks)
        VALUES (?,?,?, 'POSTED', ?)`)
      .run(invoiceNo, customer_name.trim(), invoice_date || now(), remarks || null);
    const invId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO sales_invoice_lines (invoice_id, item_id, qty, qty_returned, rate, gst_pct)
        VALUES (?,?,?,0,?,?)`);
    for (const l of lines) {
      ins.run(invId, l.item_id, Number(l.qty), Number(l.rate), Number(l.gst_pct) || 0);
      postStockTransaction({
        item_id: l.item_id,
        txn_type: 'SALES_OUT',
        qty: Number(l.qty),
        reference_type: 'SALES_INVOICE',
        reference_id: invId,
        txn_date: invoice_date || now(),
        remarks: `Sale against ${invoiceNo}`,
      });
    }
    return invId;
  });

  try {
    const invId = tx();
    res.status(201).json(db.prepare(INVOICE_SELECT + ` WHERE si.invoice_id=?`).get(invId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/sales/:id/return', (req, res) => {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE invoice_id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Invoice is cancelled' });

  const { line_id, qty, remarks } = req.body;
  const line = db.prepare('SELECT * FROM sales_invoice_lines WHERE line_id=? AND invoice_id=?').get(line_id, inv.invoice_id);
  if (!line) return res.status(404).json({ error: 'Invoice line not found' });
  const returnQty = Number(qty);
  if (!(returnQty > 0)) return res.status(400).json({ error: 'Return qty must be > 0' });
  if (line.qty_returned + returnQty > line.qty) {
    return res.status(400).json({ error: `Return exceeds sold qty (sold ${line.qty}, already returned ${line.qty_returned})` });
  }

  const tx = db.transaction(() => {
    postStockTransaction({
      item_id: line.item_id,
      txn_type: 'SALES_RETURN_IN',
      qty: returnQty,
      reference_type: 'SALES_INVOICE',
      reference_id: inv.invoice_id,
      txn_date: req.body.return_date || now(),
      remarks: `Return against ${inv.invoice_no}`,
    });
    db.prepare('UPDATE sales_invoice_lines SET qty_returned=? WHERE line_id=?')
      .run(round2(line.qty_returned + returnQty), line_id);
    db.prepare(`INSERT INTO sales_returns (invoice_id, item_id, qty, rate, return_date, remarks)
        VALUES (?,?,?,?,?,?)`)
      .run(inv.invoice_id, line.item_id, returnQty, line.rate, req.body.return_date || now(), remarks || null);
  });

  try {
    tx();
    res.json(db.prepare(INVOICE_SELECT + ` WHERE si.invoice_id=?`).get(inv.invoice_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/sales/:id/cancel', (req, res) => {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE invoice_id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const ret = db.prepare('SELECT COALESCE(SUM(qty),0) q FROM sales_returns WHERE invoice_id=?').get(inv.invoice_id);
  if (ret.q > 0) return res.status(400).json({ error: 'Cannot cancel an invoice with returns; reverse the returns first' });

  const tx = db.transaction(() => {
    const lines = db.prepare('SELECT * FROM sales_invoice_lines WHERE invoice_id=?').all(inv.invoice_id);
    for (const l of lines) {
      postStockTransaction({
        item_id: l.item_id,
        txn_type: 'ADJUSTMENT_IN',
        qty: l.qty,
        reference_type: 'SALES_INVOICE',
        reference_id: inv.invoice_id,
        remarks: `Reverse of cancelled invoice ${inv.invoice_no}`,
      });
    }
    db.prepare(`UPDATE sales_invoices SET status='CANCELLED' WHERE invoice_id=?`).run(inv.invoice_id);
  });
  tx();
  res.json({ ok: true });
});

export default router;
