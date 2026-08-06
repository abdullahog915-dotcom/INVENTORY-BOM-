import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { search = '' } = req.query;
  let sql = `SELECT c.*,
      (SELECT COUNT(*) FROM sales_invoices si WHERE si.company_id=c.company_id
         AND (si.customer_id=c.customer_id OR (si.customer_id IS NULL AND si.customer_name=c.customer_name))) AS invoice_count
      FROM customers c WHERE c.company_id=?`;
  const params = [req.companyId];
  if (search) { sql += ` AND c.customer_name LIKE ?`; params.push(`%${search}%`); }
  sql += ` ORDER BY c.customer_name`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.customer_name || !String(b.customer_name).trim()) {
    return res.status(400).json({ error: 'Customer name required' });
  }
  const info = db.prepare(`INSERT INTO customers
      (company_id, customer_name, billing_address, shipping_address, gstin, state, contact_no)
      VALUES (?,?,?,?,?,?,?)`)
    .run(req.companyId, String(b.customer_name).trim(), b.billing_address || null,
      b.shipping_address || null, b.gstin || null, b.state || null, b.contact_no || null);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE customer_id=?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE customer_id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const b = req.body;
  db.prepare(`UPDATE customers SET customer_name=?, billing_address=?, shipping_address=?, gstin=?, state=?, contact_no=?
      WHERE customer_id=?`)
    .run(b.customer_name !== undefined ? b.customer_name : c.customer_name,
      b.billing_address !== undefined ? b.billing_address : c.billing_address,
      b.shipping_address !== undefined ? b.shipping_address : c.shipping_address,
      b.gstin !== undefined ? b.gstin : c.gstin,
      b.state !== undefined ? b.state : c.state,
      b.contact_no !== undefined ? b.contact_no : c.contact_no, c.customer_id);
  res.json(db.prepare('SELECT * FROM customers WHERE customer_id=?').get(c.customer_id));
});

export default router;
