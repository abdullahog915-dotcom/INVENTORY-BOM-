import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../ledger.js';

const router = Router();

const TYPE_PREFIX = { RAW_MATERIAL: 'RM', SEMI_FINISHED: 'SF', FINISHED_GOOD: 'FG', SCRAP: 'SC' };

const BASE_GROUPS = [
  { name: 'Raw Material', item_type: 'RAW_MATERIAL' },
  { name: 'Semi Finished', item_type: 'SEMI_FINISHED' },
  { name: 'Finished Good', item_type: 'FINISHED_GOOD' },
  { name: 'Scrap', item_type: 'SCRAP' },
];

function generateSku(itemType, category) {
  const prefix = TYPE_PREFIX[itemType] || 'IT';
  const cat = (category || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
  const like = `${prefix}-${cat}-%`;
  /* sku is globally UNIQUE (across all companies) so search without company filter */
  const row = db
    .prepare(`SELECT sku FROM items WHERE sku LIKE ? ORDER BY sku DESC LIMIT 1`)
    .get(like);
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

/* Register/update a group with its base item_type (used when items are saved
   with a group the user may or may not have created via the groups API). */
const upsertGroup = (name, itemType, companyId) => {
  const row = db.prepare(`SELECT 1 FROM groups WHERE company_id=? AND name=?`).get(companyId, name);
  if (row) {
    if (itemType && BASE_GROUPS.some(g => g.item_type === itemType)) {
      db.prepare(`UPDATE groups SET item_type=? WHERE company_id=? AND name=?`).run(itemType, companyId, name);
    }
  } else {
    db.prepare(`INSERT INTO groups (company_id, name, item_type) VALUES (?,?,?)`)
      .run(companyId, name, BASE_GROUPS.some(g => g.item_type === itemType) ? itemType : null);
  }
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

/* Ensure the 4 base groups exist for this company, then return all groups
   as [{ name, item_type }] — custom sub-groups carry the base type they were
   created under so item_type stays derivable from the selected group. */
router.get('/groups', (req, res) => {
  const seed = db.prepare(`INSERT INTO groups (company_id, name, item_type) VALUES (?,?,?)
      ON CONFLICT(company_id, name) DO NOTHING`);
  for (const g of BASE_GROUPS) seed.run(req.companyId, g.name, g.item_type);

  const master = db.prepare(`SELECT name, item_type FROM groups WHERE company_id=? ORDER BY
      CASE WHEN name IN (?,?,?,?) THEN 0 ELSE 1 END, name`)
    .all(req.companyId, ...BASE_GROUPS.map(g => g.name));
  const legacy = db.prepare(`SELECT DISTINCT grp, item_type FROM items WHERE company_id=? AND grp IS NOT NULL AND grp != '' ORDER BY grp`)
    .all(req.companyId);
  const merged = new Map();
  for (const g of master) merged.set(g.name, g.item_type);
  for (const g of legacy) if (!merged.has(g.grp)) merged.set(g.grp, g.item_type);
  res.json([...merged.entries()].map(([name, item_type]) => ({ name, item_type })));
});

router.post('/groups', (req, res) => {
  const name = String(req.body.name || '').trim();
  const itemType = String(req.body.item_type || '');
  if (!name) return res.status(400).json({ error: 'Group name required' });
  if (!BASE_GROUPS.some(g => g.item_type === itemType)) {
    return res.status(400).json({ error: 'Group must be tagged with a base type (RAW_MATERIAL/SEMI_FINISHED/FINISHED_GOOD/SCRAP)' });
  }
  db.prepare(`INSERT INTO groups (company_id, name, item_type) VALUES (?,?,?)
      ON CONFLICT(company_id, name) DO UPDATE SET item_type=excluded.item_type`)
    .run(req.companyId, name, itemType);
  res.status(201).json({ name, item_type: itemType });
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
  const required = ['item_name', 'unit'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: `Missing field: ${f}` });

  /* item_type is derived from the selected group's mapping when not supplied */
  let itemType = b.item_type;
  if (!itemType && b.grp) {
    const g = db.prepare('SELECT item_type FROM groups WHERE company_id=? AND name=?').get(req.companyId, String(b.grp).trim());
    if (g && g.item_type) itemType = g.item_type;
  }
  if (!itemType) return res.status(400).json({ error: 'item_type required (select a group with a base type)' });

  const sku = (b.sku && String(b.sku).trim()) || generateSku(itemType, b.category);
  if (b.category) upsertMaster('categories', String(b.category).trim(), req.companyId);
  if (b.grp) upsertGroup(String(b.grp).trim(), itemType, req.companyId);

  const openingQty = Number(b.current_stock_qty) || 0;
  const purchaseRate = Number(b.last_purchase_rate) || 0;
  let avgCost = Number(b.avg_cost_rate) || 0;
  let stockValue = 0;
  if (openingQty > 0) {
    /* For brand-new items, avg cost equals the entered purchase rate when no prior stock exists */
    if (!avgCost || avgCost === 0) avgCost = purchaseRate;
    stockValue = round2(openingQty * avgCost);
  }

  try {
    const info = db.prepare(`INSERT INTO items
      (company_id, sku, item_name, item_type, category, grp, unit, hsn_code, gst_pct, reorder_level,
       current_stock_qty, avg_cost_rate, current_stock_value, last_purchase_rate, sale_rate, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(req.companyId, sku, b.item_name.trim(), itemType, b.category || null, b.grp || null, b.unit,
        b.hsn_code || null, Number(b.gst_pct) || 0, Number(b.reorder_level) || 0,
        openingQty, avgCost, stockValue,
        purchaseRate, Number(b.sale_rate) || 0);
    const newItem = db.prepare('SELECT * FROM items WHERE item_id=?').get(info.lastInsertRowid);

    /* Write stock_ledger opening balance entry so ledger/reports stay consistent */
    if (openingQty > 0) {
      const balRow = db.prepare('SELECT balance_qty, balance_value FROM stock_ledger WHERE item_id=? ORDER BY ledger_id DESC LIMIT 1').get(newItem.item_id);
      const prevBal = balRow ? Number(balRow.balance_qty) : 0;
      const prevVal = balRow ? Number(balRow.balance_value) : 0;
      const newBal = prevBal + openingQty;
      const newVal = round2(prevVal + stockValue);
      db.prepare(`INSERT INTO stock_ledger
        (company_id, item_id, txn_date, txn_type, qty, rate, value, balance_qty, balance_value, remarks)
        VALUES (?,?,CURRENT_TIMESTAMP,'ADJUSTMENT_IN',?,?,?,?,?,?)`)
        .run(req.companyId, newItem.item_id, openingQty, avgCost, stockValue, newBal, newVal, 'Opening balance (item creation)');
    }

    res.status(201).json(newItem);
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
  if (b.grp) upsertGroup(String(b.grp).trim(), b.item_type || item.item_type, req.companyId);
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
