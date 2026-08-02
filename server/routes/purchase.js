import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction, round2 } from '../ledger.js';

const router = Router();

function nextPoNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT po_no FROM purchase_orders ORDER BY po_id DESC LIMIT 1').get();
  let seq = 1;
  if (row) {
    const m = row.po_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `PO-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------- Vendors ---------- */

router.get('/vendors', (req, res) => {
  const rows = db.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM purchase_orders p WHERE p.vendor_id=v.vendor_id) AS po_count
      FROM vendors v ORDER BY v.vendor_name`).all();
  res.json(rows);
});

router.post('/vendors', (req, res) => {
  const b = req.body;
  if (!b.vendor_name) return res.status(400).json({ error: 'vendor_name required' });
  const info = db.prepare(`INSERT INTO vendors (vendor_name, vendor_type, contact_no, address, gstin)
      VALUES (?,?,?,?,?)`)
    .run(b.vendor_name.trim(), b.vendor_type || 'SUPPLIER', b.contact_no || null,
      b.address || null, b.gstin || null);
  res.status(201).json(db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(info.lastInsertRowid));
});

router.put('/vendors/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const b = req.body;
  db.prepare(`UPDATE vendors SET vendor_name=?, vendor_type=?, contact_no=?, address=?, gstin=?
      WHERE vendor_id=?`)
    .run(b.vendor_name ?? v.vendor_name, b.vendor_type ?? v.vendor_type,
      b.contact_no ?? v.contact_no, b.address ?? v.address, b.gstin ?? v.gstin, v.vendor_id);
  res.json(db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(v.vendor_id));
});

router.get('/vendors/:id/rate-history', (req, res) => {
  const rows = db.prepare(`SELECT pol.item_id, i.sku, i.item_name, i.unit,
        pol.rate, pol.gst_pct, pol.qty_ordered, pol.qty_received, p.po_no, p.po_date
      FROM purchase_order_lines pol
      JOIN purchase_orders p ON p.po_id=pol.po_id
      JOIN items i ON i.item_id=pol.item_id
      WHERE p.vendor_id=? AND p.status != 'CANCELLED'
      ORDER BY p.po_date DESC`).all(req.params.id);
  res.json(rows);
});

/* ---------- Purchase Orders ---------- */

router.get('/purchase', (req, res) => {
  const { status = '', search = '' } = req.query;
  let sql = `SELECT p.*, v.vendor_name, v.gstin,
      (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS line_count,
      (SELECT SUM(l.qty_ordered - l.qty_received) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS qty_pending
      FROM purchase_orders p LEFT JOIN vendors v ON v.vendor_id=p.vendor_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND p.status=?`; params.push(status); }
  if (search) { sql += ` AND (p.po_no LIKE ? OR v.vendor_name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY p.po_id DESC LIMIT 300`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/purchase/:id', (req, res) => {
  const po = db.prepare(`SELECT p.*, v.vendor_name, v.contact_no, v.gstin, v.address
      FROM purchase_orders p LEFT JOIN vendors v ON v.vendor_id=p.vendor_id
      WHERE p.po_id=?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const lines = db.prepare(`SELECT l.*, i.sku, i.item_name, i.unit, i.avg_cost_rate
      FROM purchase_order_lines l JOIN items i ON i.item_id=l.item_id WHERE l.po_id=?`).all(po.po_id);
  const taxable = lines.reduce((s, l) => s + l.qty_ordered * l.rate, 0);
  const gst = lines.reduce((s, l) => s + l.qty_ordered * l.rate * l.gst_pct / 100, 0);
  res.json({ ...po, lines, taxable_value: round2(taxable), gst_value: round2(gst), total_value: round2(taxable + gst) });
});

router.post('/purchase', (req, res) => {
  const { vendor_id, po_date, remarks, lines } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'PO needs at least one line' });
  if (vendor_id) {
    const v = db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(vendor_id);
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO purchase_orders (po_no, vendor_id, po_date, status, remarks)
        VALUES (?,?,?, 'PENDING', ?)`)
      .run(nextPoNo(), vendor_id || null, po_date || now(), remarks || null);
    const poId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO purchase_order_lines (po_id, item_id, qty_ordered, qty_received, rate, gst_pct)
        VALUES (?,?,?,0,?,?)`);
    for (const l of lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.item_id);
      if (!item) throw new Error(`Item #${l.item_id} not found`);
      if (Number(l.qty_ordered) <= 0) throw new Error(`Line for ${item.sku} needs qty > 0`);
      ins.run(poId, item.item_id, Number(l.qty_ordered), Number(l.rate), Number(l.gst_pct) || 0);
    }
    return poId;
  });

  try {
    const poId = tx();
    res.status(201).json(db.prepare(`SELECT p.*, v.vendor_name FROM purchase_orders p
      LEFT JOIN vendors v ON v.vendor_id=p.vendor_id WHERE p.po_id=?`).get(poId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/purchase/:id/receive', (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE po_id=?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'CANCELLED') return res.status(400).json({ error: 'PO is cancelled' });

  const receives = req.body.lines || []; // [{line_id, qty_received}]
  const tx = db.transaction(() => {
    const getLine = db.prepare('SELECT * FROM purchase_order_lines WHERE po_line_id=? AND po_id=?');
    const updLine = db.prepare('UPDATE purchase_order_lines SET qty_received=? WHERE po_line_id=?');
    const itemStmt = db.prepare('SELECT * FROM items WHERE item_id=?');

    for (const r of receives) {
      const line = getLine.get(r.line_id, po.po_id);
      if (!line) throw new Error(`Line #${r.line_id} not found on this PO`);
      const newReceived = round2(line.qty_received + Number(r.qty_received));
      if (newReceived > line.qty_ordered) throw new Error(`Receiving more than ordered on line #${r.line_id}`);
      if (Number(r.qty_received) > 0) {
        const item = itemStmt.get(line.item_id);
        postStockTransaction({
          item_id: line.item_id,
          txn_type: 'PURCHASE_IN',
          qty: Number(r.qty_received),
          rate: line.rate,
          reference_type: 'PURCHASE_ORDER',
          reference_id: po.po_id,
          txn_date: req.body.receive_date || po.po_date || now(),
          remarks: `Purchase entry against ${po.po_no} (${item.sku})`,
        });
      }
      updLine.run(newReceived, line.po_line_id);
    }

    const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE po_id=?').all(po.po_id);
    const allReceived = lines.length > 0 && lines.every(l => l.qty_received >= l.qty_ordered);
    const anyReceived = lines.some(l => l.qty_received > 0);
    const status = allReceived ? 'RECEIVED' : (anyReceived ? 'PARTIAL' : 'PENDING');
    db.prepare('UPDATE purchase_orders SET status=? WHERE po_id=?').run(status, po.po_id);
    return status;
  });

  try {
    const status = tx();
    res.json(db.prepare(`SELECT p.*, v.vendor_name FROM purchase_orders p
      LEFT JOIN vendors v ON v.vendor_id=p.vendor_id WHERE p.po_id=?`).get(po.po_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/purchase/:id/cancel', (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE po_id=?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'RECEIVED') return res.status(400).json({ error: 'Cannot cancel a fully received PO' });
  db.prepare(`UPDATE purchase_orders SET status='CANCELLED' WHERE po_id=?`).run(po.po_id);
  res.json({ ok: true });
});

export default router;
