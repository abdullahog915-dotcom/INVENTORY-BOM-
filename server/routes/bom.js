import { Router } from 'express';
import { db } from '../db.js';
import { computeBomUnitCost, explodeBom, estimateProductionCost, bomVersionHistory, getActiveBom, getBomLines } from '../costing.js';
import { round2 } from '../ledger.js';

const router = Router();

function createBom(body, reqVersion = null) {
  const { output_item_id, output_qty, labor_cost, overhead_pct, notes, lines } = body;
  const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(output_item_id);
  if (!item) throw new Error('Output item not found');
  if (item.item_type === 'RAW_MATERIAL' || item.item_type === 'SCRAP') {
    throw new Error('BOM can only be created for Semi-Finished or Finished Good items');
  }
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('BOM needs at least one component line');

  let version = reqVersion;
  if (!version) {
    const active = getActiveBom(output_item_id);
    if (active) {
      db.prepare('UPDATE bom_headers SET is_active=0 WHERE bom_id=?').run(active.bom_id);
      version = active.version + 1;
    } else {
      const any = db.prepare('SELECT MAX(version) v FROM bom_headers WHERE output_item_id=?').get(output_item_id);
      version = (any?.v || 0) + 1;
    }
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO bom_headers
      (output_item_id, output_qty, version, labor_cost, overhead_pct, is_active, notes)
      VALUES (?,?,?,?,?,1,?)`)
      .run(output_item_id, Number(output_qty) || 1, version, Number(labor_cost) || 0,
        Number(overhead_pct) || 0, notes || null);
    const bomId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO bom_lines
      (bom_id, component_item_id, qty_required, wastage_pct, unit_cost_snapshot)
      VALUES (?,?,?,?,?)`);
    for (const l of lines) {
      const comp = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.component_item_id);
      if (!comp) throw new Error(`Component item #${l.component_item_id} not found`);
      if (Number(l.qty_required) <= 0) throw new Error(`Component ${comp.sku} needs qty > 0`);
      ins.run(bomId, comp.item_id, Number(l.qty_required), Number(l.wastage_pct) || 0,
        round2(comp.avg_cost_rate));
    }
    return bomId;
  });
  return tx();
}

router.get('/', (req, res) => {
  const { output_item_id } = req.query;
  let sql = `SELECT bh.*, i.sku, i.item_name, i.item_type, i.unit,
             (SELECT COUNT(*) FROM bom_lines bl WHERE bl.bom_id=bh.bom_id) AS line_count
             FROM bom_headers bh JOIN items i ON i.item_id=bh.output_item_id`;
  const params = [];
  if (output_item_id) { sql += ` WHERE bh.output_item_id=?`; params.push(output_item_id); }
  sql += ` ORDER BY bh.output_item_id, bh.version DESC`;
  const rows = db.prepare(sql).all(...params);
  const out = rows.map(r => {
    let cost = { unitCost: 0, materialCost: 0, labor: 0, overhead: 0 };
    try { cost = computeBomUnitCost(r.bom_id); } catch { /* inactive/edited BOM may fail */ }
    return { ...r, unit_cost: round2(cost.unitCost), material_cost: round2(cost.materialCost) };
  });
  res.json(out);
});

router.get('/explode', (req, res) => {
  const { output_item_id, qty } = req.query;
  if (!output_item_id) return res.status(400).json({ error: 'output_item_id required' });
  try {
    const estimate = estimateProductionCost(Number(output_item_id), Number(qty) || 1);
    res.json(estimate);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const bom = db.prepare(`SELECT bh.*, i.sku, i.item_name, i.item_type, i.unit
      FROM bom_headers bh JOIN items i ON i.item_id=bh.output_item_id WHERE bh.bom_id=?`).get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  const lines = getBomLines(bom.bom_id);
  const cost = computeBomUnitCost(bom.bom_id);
  res.json({ ...bom, lines, cost });
});

router.get('/:id/versions', (req, res) => {
  const bom = db.prepare('SELECT output_item_id FROM bom_headers WHERE bom_id=?').get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  res.json(bomVersionHistory(bom.output_item_id));
});

router.post('/', (req, res) => {
  try {
    const bomId = createBom(req.body);
    const full = db.prepare(`SELECT bh.*, i.sku, i.item_name FROM bom_headers bh
                             JOIN items i ON i.item_id=bh.output_item_id WHERE bh.bom_id=?`).get(bomId);
    res.status(201).json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/revise', (req, res) => {
  try {
    const bom = db.prepare('SELECT * FROM bom_headers WHERE bom_id=?').get(req.params.id);
    if (!bom) return res.status(404).json({ error: 'BOM not found' });
    const bomId = createBom({ ...req.body, output_item_id: bom.output_item_id }, null);
    const full = db.prepare(`SELECT bh.*, i.sku, i.item_name FROM bom_headers bh
                             JOIN items i ON i.item_id=bh.output_item_id WHERE bh.bom_id=?`).get(bomId);
    res.status(201).json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
