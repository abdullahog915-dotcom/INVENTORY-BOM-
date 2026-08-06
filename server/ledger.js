import { db, LEDGER_IN_TYPES, now } from './db.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function getItem(itemId) {
  return db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
}

/** Chronologically-last ledger row for an item at or before txnDate. */
function balanceAt(itemId, txnDate) {
  return db
    .prepare(`SELECT balance_qty, balance_value FROM stock_ledger
              WHERE item_id=? AND txn_date <= ?
              ORDER BY txn_date DESC, ledger_id DESC LIMIT 1`)
    .get(itemId, txnDate);
}

/** True when this date lands before an existing row, i.e. the insert is back-dated. */
function hasLaterRows(itemId, txnDate) {
  return !!db
    .prepare('SELECT 1 FROM stock_ledger WHERE item_id=? AND txn_date > ? LIMIT 1')
    .get(itemId, txnDate);
}

/**
 * Replays every ledger row for an item in chronological order, rebuilding the
 * running weighted-average cost and the balance columns, then syncs the item.
 * Transaction `value` columns are left as recorded so deliberate rates survive.
 * Returns the final balance.
 */
export function recomputeItemLedger(itemId) {
  const rows = db
    .prepare('SELECT ledger_id, txn_type, qty, rate FROM stock_ledger WHERE item_id=? ORDER BY txn_date, ledger_id')
    .all(itemId);

  const upd = db.prepare('UPDATE stock_ledger SET balance_qty=?, balance_value=? WHERE ledger_id=?');
  let qty = 0;
  let avg = 0;

  for (const r of rows) {
    const rQty = round2(Math.abs(r.qty));
    if (LEDGER_IN_TYPES.has(r.txn_type)) {
      /* The stored rate is already the resolved rate at posting time, so it is
         replayed verbatim — including a deliberate 0 for a free receipt. */
      const inRate = Number(r.rate) || 0;
      const total = qty + rQty;
      avg = total > 0 ? (qty * avg + rQty * inRate) / total : inRate;
      qty = round2(total);
    } else {
      qty = round2(qty - rQty);
    }
    if (qty < 0) throw new Error('Transaction would drive stock negative at ' + r.ledger_id);
    upd.run(qty, round2(qty * avg), r.ledger_id);
  }

  db.prepare(
    'UPDATE items SET current_stock_qty=?, avg_cost_rate=?, current_stock_value=?, updated_at=CURRENT_TIMESTAMP WHERE item_id=?'
  ).run(qty, round2(avg), round2(qty * avg), itemId);

  return { qty, rate: round2(avg), value: round2(qty * avg) };
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
  const txnDate = p.txn_date || now();

  /* A back-dated entry must be valued against the stock as it stood on that
     date, and every later row has to be rebuilt on top of it. */
  const backDated = hasLaterRows(item.item_id, txnDate);
  const at = backDated ? balanceAt(item.item_id, txnDate) : null;
  const curQty = backDated ? round2(at?.balance_qty || 0) : round2(item.current_stock_qty);
  const curRate = backDated
    ? round2(at && at.balance_qty ? at.balance_value / at.balance_qty : 0)
    : round2(item.avg_cost_rate);

  if (sign < 0 && curQty < qty) {
    throw new Error(`Insufficient stock: available ${curQty} ${item.unit}, trying to remove ${qty}`);
  }

  let rate;
  let value;
  let newRate = curRate;

  if (sign > 0) {
    /* An explicit 0 is a genuine free receipt; only a missing/invalid rate
       falls back to current average cost (e.g. returns, adjustments). */
    const given = p.rate === undefined || p.rate === null || p.rate === '' ? NaN : Number(p.rate);
    rate = Number.isFinite(given) && given >= 0 ? round2(given) : curRate;
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

  db.exec('SAVEPOINT post_stock');
  try {
    const info = db
      .prepare(`INSERT INTO stock_ledger
        (company_id, item_id, txn_date, txn_type, qty, rate, value, balance_qty, balance_value, reference_type, reference_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.company_id, item.item_id, txnDate, p.txn_type, qty, round2(rate), value, newQty, newValue,
        p.reference_type || null, p.reference_id || null, p.remarks || null);

    if (backDated) {
      /* Rebuilds this row and every later one; throws if any goes negative. */
      recomputeItemLedger(item.item_id);
    } else {
      db.prepare(
        `UPDATE items SET current_stock_qty=?, avg_cost_rate=?, current_stock_value=?, updated_at=CURRENT_TIMESTAMP WHERE item_id=?`
      ).run(newQty, round2(newRate), newValue, item.item_id);
    }

    if (p.txn_type === 'PURCHASE_IN') {
      db.prepare('UPDATE items SET last_purchase_rate=? WHERE item_id=?').run(rate, item.item_id);
    }

    db.exec('RELEASE post_stock');
    return info.lastInsertRowid;
  } catch (e) {
    db.exec('ROLLBACK TO post_stock');
    db.exec('RELEASE post_stock');
    throw e;
  }
}

/**
 * Rebuilds balances for any item whose stored running balance disagrees with a
 * chronological replay. Detection compares actual balances rather than row
 * ordering, so an item with legitimately back-dated history is not rebuilt on
 * every start once its balances are correct.
 */
export function repairLedgerBalances() {
  const candidates = db
    .prepare(`SELECT DISTINCT a.item_id FROM stock_ledger a JOIN stock_ledger b
              ON a.item_id=b.item_id AND b.ledger_id > a.ledger_id AND b.txn_date < a.txn_date`)
    .all();

  const repaired = [];
  for (const { item_id } of candidates) {
    const rows = db
      .prepare('SELECT ledger_id, txn_type, qty, balance_qty FROM stock_ledger WHERE item_id=? ORDER BY txn_date, ledger_id')
      .all(item_id);
    let qty = 0;
    let drifted = false;
    for (const r of rows) {
      const rQty = round2(Math.abs(r.qty));
      qty = round2(LEDGER_IN_TYPES.has(r.txn_type) ? qty + rQty : qty - rQty);
      if (Math.abs(qty - Number(r.balance_qty)) > 0.01) { drifted = true; break; }
    }
    if (!drifted) continue;
    try {
      recomputeItemLedger(item_id);
      repaired.push(item_id);
    } catch (e) {
      console.warn(`Ledger repair skipped for item #${item_id}: ${e.message}`);
    }
  }
  if (repaired.length) console.log(`Rebuilt stock ledger balances for ${repaired.length} item(s).`);
  return repaired;
}

/** Balance of an item just before a given date (exclusive). */
export function openingBalance(itemId, fromDate) {
  const row = db
    .prepare(`SELECT balance_qty, balance_value FROM stock_ledger
              WHERE item_id=? AND date(txn_date) < date(?) ORDER BY txn_date DESC, ledger_id DESC LIMIT 1`)
    .get(itemId, fromDate);
  return { qty: round2(row?.balance_qty || 0), value: round2(row?.balance_value || 0) };
}

/** Balance of an item on or before a given date (inclusive). */
export function closingBalance(itemId, toDate) {
  const row = db
    .prepare(`SELECT balance_qty, balance_value FROM stock_ledger
              WHERE item_id=? AND date(txn_date) <= date(?) ORDER BY txn_date DESC, ledger_id DESC LIMIT 1`)
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
