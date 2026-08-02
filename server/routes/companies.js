import { Router } from 'express';
import { db } from '../db.js';
import { seedCompany } from '../seed.js';

const router = Router();

const COLS = ['name', 'address', 'gstin', 'state', 'logo', 'bank_details', 'invoice_terms'];

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY is_default DESC, company_id').all());
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Company name required' });
  try {
    const info = db.prepare(`INSERT INTO companies
        (name, address, gstin, state, logo, bank_details, invoice_terms, is_default)
        VALUES (?,?,?,?,?,?,?,0)`)
      .run(String(b.name).trim(), b.address || null, b.gstin || null, b.state || null,
        b.logo || null, b.bank_details || null, b.invoice_terms || null);
    const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(info.lastInsertRowid);
    if (b.seed_demo) {
      seedCompany(company.company_id);
    }
    res.status(201).json(company);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE company_id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const b = req.body;
  db.prepare(`UPDATE companies SET name=?, address=?, gstin=?, state=?, logo=?, bank_details=?, invoice_terms=?
      WHERE company_id=?`)
    .run(b.name ?? c.name, b.address ?? c.address, b.gstin ?? c.gstin, b.state ?? c.state,
      b.logo ?? c.logo, b.bank_details ?? c.bank_details, b.invoice_terms ?? c.invoice_terms, c.company_id);
  res.json(db.prepare('SELECT * FROM companies WHERE company_id=?').get(c.company_id));
});

export default router;
