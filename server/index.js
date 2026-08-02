import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { db, now } from './db.js';
import { ensureSeed } from './seed.js';

import itemsRouter from './routes/items.js';
import bomRouter from './routes/bom.js';
import productionRouter from './routes/production.js';
import purchaseRouter from './routes/purchase.js';
import salesRouter from './routes/sales.js';
import jobworkRouter from './routes/jobwork.js';
import adjustmentsRouter from './routes/adjustments.js';
import ledgerRouter from './routes/ledger.js';
import reportsRouter from './routes/reports.js';
import dashboardRouter from './routes/dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

ensureSeed();

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));
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
