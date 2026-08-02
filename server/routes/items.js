import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../ledger.js';

const router = Router();

const TYPE_PREFIX = { RAW_MATERIAL: 'RM', SEMI_FINISHED: 'SF', FINISHED_GOOD: 'FG', SCRAP: 'SC' };

function generateSku(itemType, category, companyId) {
  const prefix = TYPE_PREFIX[itemType] || 'IT';
  const cat = (category || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
  const like = `${prefix}-${cat}-%`;
  const row = db
    .prepare(`SELECT sku FROM items WHERE company_id=? AND sku LIKE ? ORDER BY sku DESC LIMIT 1`)
    .get(companyId, like);
  let seq = 1;
  if (row) {
    const m = row.sku.match(/(\d+)$/);
    seq = m ? parseInt(m[1], 10) + 1 : 1;
  }
  return `${prefix}-${cat}-${String(seq).padStart(3, '0')}`;
}

/* ---- Category & Group master (creatable dropdown data) ---- */
const upsertMaster = (table, name, companyId) => {
  const row = db.prepare(`SELECT 1 FROM ${table} WHERE company_id=? AND name=?`).get(companyId, name);
  if (!row) db.prepare(`INSERT INTO ${table} (company_id, name) VALUES (?,?)`).run(companyId, name);
};

router.get('/categories', (req, res) => {
  const master = db.prepare(`SELECT name FROM categories WHERE company_id=? ORDER BY name`).all(req.companyId).map(r => r.name);
  const legacy = db.prepare(`SELECT DISTINCT category FROM items WHERE company_id=? AND category IS NOT NULL AND category != '' ORDER BY category`)
    .all(req.companyId).map(r => r.category);
  res.json([...new Set([...master, ...legacy])]);
});

router.post('/categories', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name required' });
  upsertMaster('categories', name, req.companyId);
  res.status(201).json({ name });
});

router.get('/groups', (req, res) => {
  const master = db.prepare(`SELECT name FROM groups WHERE company_id=? ORDER BY name`).all(req.companyId).map(r => r.name);
  const legacy = db.prepare(`SELECT DISTINCT grp FROM items WHERE company_id=? AND grp IS NOT NULL AND grp != '' ORDER BY grp`)
    .all(req.companyId).map(r => r.grp);
  res.json([...new Set([...master, ...legacy])]);
});

router.post('/groups', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name required' });
  upsertMaster('groups', name, req.companyId);
  res.status(201).json({ name });
});

/* ---- Items ---- */
router.get('/', (req, res) => {
  const { search = '', type = '', category = '', include_inactive = '0' } = req.query;
  let sql = `SELECT * FROM items WHERE company_id=?`;
  const params = [req.companyId];
  if (type) { sql += ` AND item_type = ?`; params.push(type); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (search) { sql += ` AND (sku LIKE ? OR item_name LIKE ? OR hsn_code LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (include_inactive !== '1') sql += ` AND is_active = 1`;
  sql += ` ORDER BY item_type, sku`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...r, current_stock_value: round2(r.current_stock_value) })));
});

router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.post('/', (req, res) => {
  const b = req.body;
  const required = ['item_name', 'item_type', 'unit'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: `Missing field: ${f}` });

  const sku = (b.sku && String(b.sku).trim()) || generateSku(b.item_type, b.category, req.companyId);
  if (b.category) upsertMaster('categories', String(b.category).trim(), req.companyId);
  if (b.grp) upsertMaster('groups', String(b.grp).trim(), req.companyId);

  try {
    const info = db.prepare(`INSERT INTO items
      (company_id, sku, item_name, item_type, category, grp, unit, hsn_code, gst_pct, reorder_level,
       current_stock_qty, avg_cost_rate, current_stock_value, last_purchase_rate, sale_rate, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(req.companyId, sku, b.item_name.trim(), b.item_type, b.category || null, b.grp || null, b.unit,
        b.hsn_code || null, Number(b.gst_pct) || 0, Number(b.reorder_level) || 0,
        Number(b.current_stock_qty) || 0, Number(b.avg_cost_rate) || 0, 0,
        Number(b.last_purchase_rate) || 0, Number(b.sale_rate) || 0);
    res.status(201).json(db.prepare('SELECT * FROM items WHERE item_id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'SKU already exists' });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const b = req.body;
  if (b.category) upsertMaster('categories', String(b.category).trim(), req.companyId);
  if (b.grp) upsertMaster('groups', String(b.grp).trim(), req.companyId);
  db.prepare(`UPDATE items SET
      item_name=?, item_type=?, category=?, grp=?, unit=?, hsn_code=?, gst_pct=?, reorder_level=?,
      sale_rate=?, is_active=?, updated_at=CURRENT_TIMESTAMP
      WHERE item_id=?`)
    .run(b.item_name ?? item.item_name, b.item_type ?? item.item_type, b.category ?? item.category,
      b.grp !== undefined ? b.grp : item.grp, b.unit ?? item.unit, b.hsn_code ?? item.hsn_code,
      b.gst_pct !== undefined ? Number(b.gst_pct) : item.gst_pct,
      Number(b.reorder_level) ?? item.reorder_level,
      Number(b.sale_rate) ?? item.sale_rate, b.is_active !== undefined ? Number(b.is_active) : item.is_active,
      item.item_id);
  res.json(db.prepare('SELECT * FROM items WHERE item_id=?').get(item.item_id));
});

export default router;
