import { db, LEDGER_IN_TYPES, now } from './db.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function getItem(itemId) {
  return db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
}

/**
 * The single entry point for every stock movement in the system.
 * Recalculates Weighted Average Cost on IN, values OUT at current avg cost,
 * and records a running balance in stock_ledger.
 *
 * @param {object} p
 * @param {number} p.item_id
 * @param {string} p.txn_type   one of LEDGER txn types
 * @param {number} p.qty        always positive; direction implied by txn_type
 * @param {number} [p.rate]     incoming rate for IN / explicit rate for OUT.
 *                              OUT defaults to current avg cost when omitted.
 * @param {string} [p.reference_type]
 * @param {number} [p.reference_id]
 * @param {string} [p.remarks]
 * @param {string} [p.txn_date] optional 'YYYY-MM-DD HH:MM:SS'
 */
export function postStockTransaction(p) {
  const item = getItem(p.item_id);
  if (!item) throw new Error(`Item #${p.item_id} not found`);

  const qty = round2(Math.abs(Number(p.qty) || 0));
  if (qty === 0) throw new Error('Quantity cannot be zero');

  const sign = LEDGER_IN_TYPES.has(p.txn_type) ? 1 : -1;
  const curQty = round2(item.current_stock_qty);
  const curRate = round2(item.avg_cost_rate);

  let rate;
  let value;
  let newRate = curRate;

  if (sign > 0) {
    rate = round2(Number(p.rate) || 0);
    if (rate <= 0) rate = curRate; // e.g. sales returns/adjustments value at current avg cost
    const totalQty = curQty + qty;
    newRate = totalQty > 0 ? (curQty * curRate + qty * rate) / totalQty : rate;
    value = qty * rate;
  } else {
    rate = round2(p.rate && Number(p.rate) > 0 ? Number(p.rate) : curRate);
    value = qty * rate;
  }

  const newQty = round2(curQty + sign * qty);
  const newValue = round2(newQty * newRate);
  value = round2(value);

  const txnDate = p.txn_date || now();

  const info = db
    .prepare(`INSERT INTO stock_ledger
      (item_id, txn_date, txn_type, qty, rate, value, balance_qty, balance_value, reference_type, reference_id, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item.item_id, txnDate, p.txn_type, qty, round2(rate), value, newQty, newValue,
      p.reference_type || null, p.reference_id || null, p.remarks || null);

  db.prepare(
    `UPDATE items SET current_stock_qty=?, avg_cost_rate=?, current_stock_value=?, updated_at=CURRENT_TIMESTAMP WHERE item_id=?`
  ).run(newQty, round2(newRate), newValue, item.item_id);

  if (p.txn_type === 'PURCHASE_IN') {
    db.prepare('UPDATE items SET last_purchase_rate=? WHERE item_id=?').run(rate, item.item_id);
  }

  return info.lastInsertRowid;
}

/** Balance of an item just before a given date (exclusive). */
export function openingBalance(itemId, fromDate) {
  const row = db
    .prepare(`SELECT balance_qty, balance_value FROM stock_ledger
              WHERE item_id=? AND date(txn_date) < date(?) ORDER BY ledger_id DESC LIMIT 1`)
    .get(itemId, fromDate);
  return { qty: round2(row?.balance_qty || 0), value: round2(row?.balance_value || 0) };
}

/** Balance of an item on or before a given date (inclusive). */
export function closingBalance(itemId, toDate) {
  const row = db
    .prepare(`SELECT balance_qty, balance_value FROM stock_ledger
              WHERE item_id=? AND date(txn_date) <= date(?) ORDER BY ledger_id DESC LIMIT 1`)
    .get(itemId, toDate);
  return { qty: round2(row?.balance_qty || 0), value: round2(row?.balance_value || 0) };
}

export function ledgerInRange(itemId, fromDate, toDate) {
  return db
    .prepare(`SELECT * FROM stock_ledger WHERE item_id=? AND date(txn_date) BETWEEN date(?) AND date(?)
              ORDER BY txn_date, ledger_id`)
    .all(itemId, fromDate, toDate);
}

export { round2 };
