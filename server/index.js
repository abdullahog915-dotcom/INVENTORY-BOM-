import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { db, now, getDefaultCompanyId } from './db.js';
import { ensureSeed } from './seed.js';
import { repairLedgerBalances } from './ledger.js';

import itemsRouter from './routes/items.js';
import customersRouter from './routes/customers.js';
import companiesRouter from './routes/companies.js';
import bomRouter from './routes/bom.js';
import productionRouter from './routes/production.js';
import purchaseRouter from './routes/purchase.js';
import salesRouter from './routes/sales.js';
import jobworkRouter from './routes/jobwork.js';
import adjustmentsRouter from './routes/adjustments.js';
import ledgerRouter from './routes/ledger.js';
import reportsRouter from './routes/reports.js';
import dashboardRouter from './routes/dashboard.js';
import settingsRouter from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

ensureSeed();
repairLedgerBalances();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* Company scoping: every /api request resolves a company from the X-Company-Id header
   (defaulting to the default company), stored on req.companyId. */
app.use('/api', (req, res, next) => {
  const headerId = parseInt(req.headers['x-company-id'], 10);
  let companyId = Number.isInteger(headerId) ? headerId : null;
  if (companyId) {
    const c = db.prepare('SELECT company_id FROM companies WHERE company_id=?').get(companyId);
    if (!c) companyId = null;
  }
  if (!companyId) companyId = getDefaultCompanyId();
  req.companyId = companyId;
  res.locals.companyId = companyId;
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));
app.use('/api/companies', companiesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/items', itemsRouter);
app.use('/api/bom', bomRouter);
app.use('/api/production', productionRouter);
app.use('/api', purchaseRouter);      // /api/vendors, /api/purchase...
app.use('/api', salesRouter);         // /api/sales...
app.use('/api', jobworkRouter);       // /api/jobwork...
app.use('/api/adjustments', adjustmentsRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Craft ERP server running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/health`);
});
