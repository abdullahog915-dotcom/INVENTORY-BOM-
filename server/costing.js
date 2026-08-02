import { db } from './db.js';
import { round2 } from './ledger.js';

export function getActiveBom(outputItemId) {
  return db
    .prepare(`SELECT * FROM bom_headers WHERE output_item_id=? AND is_active=1 ORDER BY version DESC LIMIT 1`)
    .get(outputItemId);
}

export function getBomLines(bomId) {
  return db
    .prepare(`SELECT bl.*, i.sku, i.item_name, i.unit, i.item_type, i.avg_cost_rate
              FROM bom_lines bl JOIN items i ON i.item_id = bl.component_item_id
              WHERE bl.bom_id=?`)
    .all(bomId);
}

/** Cost of a component per unit: its BOM unit cost if it has an active BOM, else its avg cost. */
function componentUnitCost(item, visited) {
  if (item.item_type === 'SEMI_FINISHED') {
    const bom = getActiveBom(item.item_id);
    if (bom && !visited.has(bom.bom_id)) {
      return computeBomUnitCost(bom.bom_id, visited).unitCost;
    }
  }
  return round2(item.avg_cost_rate);
}

/**
 * Computes the full cost of a BOM.
 * unitCost = (Σ qty*(1+wastage%)*componentRate + labor) / output_qty * (1 + overhead%)
 */
export function computeBomUnitCost(bomId, _visited = new Set()) {
  const bom = db.prepare('SELECT * FROM bom_headers WHERE bom_id=?').get(bomId);
  if (!bom) throw new Error('BOM not found');
  if (_visited.has(bomId)) throw new Error('Circular BOM reference detected');
  const visited = new Set(_visited);
  visited.add(bomId);

  const lines = getBomLines(bomId);
  let materialCost = 0;
  const detail = [];
  for (const l of lines) {
    const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.component_item_id);
    const rate = componentUnitCost(item, visited);
    const qty = round2(l.qty_required * (1 + (l.wastage_pct || 0) / 100));
    const lineValue = round2(qty * rate);
    materialCost += lineValue;
    detail.push({ ...l, rate, qtyWithWastage: qty, lineValue });
  }
  materialCost = round2(materialCost);
  const labor = round2(bom.labor_cost || 0);
  const base = round2((materialCost + labor) / (bom.output_qty || 1));
  const overheadPct = bom.overhead_pct || 0;
  const overhead = round2(base * overheadPct / 100);
  const unitCost = round2(base + overhead);

  return { bom, lines: detail, materialCost, labor, overheadPct, overhead, unitCost, outputQty: bom.output_qty };
}

/**
 * Explodes a BOM down to leaf requirements (raw materials / items without a BOM).
 * Returns a Map: item_id -> { item, qty }
 */
export function explodeBom(outputItemId, targetQty, _visited = new Set()) {
  const bom = getActiveBom(outputItemId);
  if (!bom) throw new Error('No active BOM for this item');
  if (_visited.has(bom.bom_id)) throw new Error('Circular BOM reference detected');
  const visited = new Set(_visited);
  visited.add(bom.bom_id);

  const result = new Map();
  const scale = targetQty / (bom.output_qty || 1);
  const lines = getBomLines(bom.bom_id);

  for (const l of lines) {
    const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.component_item_id);
    const reqQty = round2(l.qty_required * (1 + (l.wastage_pct || 0) / 100) * scale);

    const childBom = item.item_type === 'SEMI_FINISHED' ? getActiveBom(item.item_id) : null;
    if (childBom && !visited.has(childBom.bom_id)) {
      const child = explodeBom(item.item_id, reqQty, visited);
      for (const [cid, cval] of child) {
        const cur = result.get(cid);
        result.set(cid, cur ? { item: cur.item, qty: round2(cur.qty + cval.qty) } : cval);
      }
    } else {
      const cur = result.get(item.item_id);
      result.set(item.item_id, cur ? { item: cur.item, qty: round2(cur.qty + reqQty) } : { item, qty: reqQty });
    }
  }
  return result;
}

/** Estimated cost breakdown for producing `plannedQty` of an item from its active BOM. */
export function estimateProductionCost(outputItemId, plannedQty) {
  const bom = getActiveBom(outputItemId);
  if (!bom) throw new Error('No active BOM for this item');

  const explosion = explodeBom(outputItemId, plannedQty);
  let material = 0;
  for (const { item, qty } of explosion.values()) {
    material += qty * round2(item.avg_cost_rate);
  }
  material = round2(material);
  const labor = round2((bom.labor_cost || 0) * plannedQty / (bom.output_qty || 1));
  const overhead = round2((material + labor) * (bom.overhead_pct || 0) / 100);

  return {
    bomId: bom.bom_id,
    materialCost: material,
    laborCost: labor,
    overheadValue: overhead,
    total: round2(material + labor + overhead),
    requirements: [...explosion.values()].map(({ item, qty }) => ({
      item_id: item.item_id, sku: item.sku, item_name: item.item_name, unit: item.unit,
      qty, rate: round2(item.avg_cost_rate), value: round2(qty * item.avg_cost_rate),
      available: round2(item.current_stock_qty),
      shortfall: round2(Math.max(0, qty - item.current_stock_qty)),
    })),
  };
}

export function bomVersionHistory(outputItemId) {
  return db
    .prepare(`SELECT bh.*,
              (SELECT COUNT(*) FROM bom_lines bl WHERE bl.bom_id=bh.bom_id) AS line_count
              FROM bom_headers bh WHERE bh.output_item_id=?
              ORDER BY bh.version DESC`)
    .all(outputItemId);
}
