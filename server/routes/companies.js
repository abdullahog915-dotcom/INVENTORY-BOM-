import { Router } from 'express';
import { db } from '../db.js';
import { seedCompany } from '../seed.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY is_default DESC, company_id').all());
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Company name required' });
  try {
    const info = db.prepare(`INSERT INTO companies
        (name, address, gstin, state, logo, bank_details, invoice_terms, phone, email, website, pan, upi_id, jurisdiction, field_defaults, is_default)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
      .run(
        String(b.name).trim(), b.address || null, b.gstin || null, b.state || null,
        b.logo || null, b.bank_details || null, b.invoice_terms || null,
        b.phone || null, b.email || null, b.website || null, b.pan || null, b.upi_id || null, b.jurisdiction || null,
        b.field_defaults && Array.isArray(b.field_defaults) ? JSON.stringify(b.field_defaults) : null
      );
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
  db.prepare(`UPDATE companies SET
      name=?, address=?, gstin=?, state=?, logo=?, bank_details=?, invoice_terms=?,
      phone=?, email=?, website=?, pan=?, upi_id=?, jurisdiction=?, field_defaults=?
      WHERE company_id=?`)
    .run(
      b.name !== undefined ? b.name : c.name, b.address !== undefined ? b.address : c.address,
      b.gstin !== undefined ? b.gstin : c.gstin, b.state !== undefined ? b.state : c.state,
      b.logo !== undefined ? b.logo : c.logo, b.bank_details !== undefined ? b.bank_details : c.bank_details,
      b.invoice_terms !== undefined ? b.invoice_terms : c.invoice_terms,
      b.phone !== undefined ? b.phone : c.phone, b.email !== undefined ? b.email : c.email,
      b.website !== undefined ? b.website : c.website, b.pan !== undefined ? b.pan : c.pan,
      b.upi_id !== undefined ? b.upi_id : c.upi_id, b.jurisdiction !== undefined ? b.jurisdiction : c.jurisdiction,
      b.field_defaults !== undefined ? (Array.isArray(b.field_defaults) ? JSON.stringify(b.field_defaults) : b.field_defaults) : c.field_defaults,
      c.company_id
    );
  res.json(db.prepare('SELECT * FROM companies WHERE company_id=?').get(c.company_id));
});

export default router;
