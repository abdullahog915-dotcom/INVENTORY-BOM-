import { Router } from 'express';
import { db } from '../db.js';
import { seedCompany } from '../seed.js';

const router = Router();

const TRANSACTION_TABLES = [
  'sales_invoice_lines', 'sales_returns', 'sales_invoices',
  'purchase_order_lines', 'purchase_orders',
  'production_consumption', 'production_scrap', 'production_orders',
  'bom_lines', 'bom_headers',
  'stock_ledger',
  'job_work_orders',
  'items', 'vendors', 'customers', 'categories', 'groups',
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
    for (const t of TRANSACTION_TABLES) {
      db.prepare(`DELETE FROM "${t}"`).run();
    }
    for (const t of TRANSACTION_TABLES) {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(t);
    }
  });
  tx();

  if (mode === 'reseed') {
    const defaultCompany = db.prepare('SELECT company_id FROM companies ORDER BY is_default DESC, company_id LIMIT 1').get();
    if (defaultCompany) seedCompany(defaultCompany.company_id);
  }

  res.json({
    ok: true,
    mode,
    companies: db.prepare('SELECT * FROM companies ORDER BY company_id').all(),
  });
});

export default router;
