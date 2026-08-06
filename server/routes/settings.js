import { Router } from 'express';
import { db } from '../db.js';
import { seedCompany } from '../seed.js';

const router = Router();

/* Deleted in FK-safe order: children before parents. Line/detail tables carry no
   company_id of their own, so they are scoped through their parent. */
const DELETES = [
  `DELETE FROM sales_invoice_lines WHERE invoice_id IN (SELECT invoice_id FROM sales_invoices WHERE company_id=?)`,
  `DELETE FROM purchase_order_lines WHERE po_id IN (SELECT po_id FROM purchase_orders WHERE company_id=?)`,
  `DELETE FROM production_consumption WHERE prod_order_id IN (SELECT prod_order_id FROM production_orders WHERE company_id=?)`,
  `DELETE FROM production_scrap WHERE prod_order_id IN (SELECT prod_order_id FROM production_orders WHERE company_id=?)`,
  `DELETE FROM bom_lines WHERE bom_id IN (SELECT bom_id FROM bom_headers WHERE company_id=?)`,
  `DELETE FROM sales_returns WHERE company_id=?`,
  `DELETE FROM sales_invoices WHERE company_id=?`,
  `DELETE FROM purchase_orders WHERE company_id=?`,
  `DELETE FROM production_orders WHERE company_id=?`,
  `DELETE FROM bom_headers WHERE company_id=?`,
  `DELETE FROM stock_ledger WHERE company_id=?`,
  `DELETE FROM job_work_orders WHERE company_id=?`,
  `DELETE FROM items WHERE company_id=?`,
  `DELETE FROM vendors WHERE company_id=?`,
  `DELETE FROM customers WHERE company_id=?`,
  `DELETE FROM categories WHERE company_id=?`,
  `DELETE FROM groups WHERE company_id=?`,
];

/**
 * Destructive full data reset. Requires confirm === "DELETE".
 * mode: 'empty' -> clear all transactional data; 'reseed' -> clear then seed demo
 * data into the default company.
 */
router.post('/reset', (req, res) => {
  const { mode = 'empty', confirm } = req.body;
  if (String(confirm).trim() !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm the destructive reset' });
  }
  if (!['empty', 'reseed'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be empty or reseed' });
  }

  const tx = db.transaction(() => {
    for (const sql of DELETES) {
      db.prepare(sql).run(req.companyId);
    }
  });
  tx();

  if (mode === 'reseed') {
    seedCompany(req.companyId);
  }

  res.json({
    ok: true,
    mode,
    companies: db.prepare('SELECT * FROM companies ORDER BY company_id').all(),
  });
});

export default router;
