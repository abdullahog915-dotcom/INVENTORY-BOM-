import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction, round2 } from '../ledger.js';
import { computeLine, computeTotals, isSameState, numberToWordsINR } from '../invoice.js';

const router = Router();

function nextPoNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT po_no FROM purchase_orders ORDER BY po_id DESC LIMIT 1').get();
  let seq = 1;
  if (row) {
    const m = row.po_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `PO-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------- Vendors ---------- */

router.get('/vendors', (req, res) => {
  const rows = db.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM purchase_orders p WHERE p.vendor_id=v.vendor_id) AS po_count
      FROM vendors v WHERE v.company_id=? ORDER BY v.vendor_name`).all(req.companyId);
  res.json(rows);
});

router.post('/vendors', (req, res) => {
  const b = req.body;
  if (!b.vendor_name) return res.status(400).json({ error: 'vendor_name required' });
  const info = db.prepare(`INSERT INTO vendors (company_id, vendor_name, vendor_type, contact_no, address, gstin, state)
      VALUES (?,?,?,?,?,?,?)`)
    .run(req.companyId, b.vendor_name.trim(), b.vendor_type || 'SUPPLIER', b.contact_no || null,
      b.address || null, b.gstin || null, b.state || null);
  res.status(201).json(db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(info.lastInsertRowid));
});

router.put('/vendors/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE vendor_id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const b = req.body;
  db.prepare(`UPDATE vendors SET vendor_name=?, vendor_type=?, contact_no=?, address=?, gstin=?, state=?
      WHERE vendor_id=?`)
    .run(b.vendor_name ?? v.vendor_name, b.vendor_type ?? v.vendor_type,
      b.contact_no ?? v.contact_no, b.address ?? v.address, b.gstin ?? v.gstin,
      b.state ?? v.state, v.vendor_id);
  res.json(db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(v.vendor_id));
});

router.get('/vendors/:id/rate-history', (req, res) => {
  const rows = db.prepare(`SELECT pol.item_id, i.sku, i.item_name, i.unit,
        pol.rate, pol.gst_pct, pol.discount_pct, pol.taxable_value, pol.qty_ordered, pol.qty_received, p.po_no, p.po_date
      FROM purchase_order_lines pol
      JOIN purchase_orders p ON p.po_id=pol.po_id
      JOIN items i ON i.item_id=pol.item_id
      WHERE p.vendor_id=? AND p.status != 'CANCELLED' AND p.company_id=?
      ORDER BY p.po_date DESC`).all(req.params.id, req.companyId);
  res.json(rows);
});

/* ---------- Purchase Orders ---------- */

const PO_SELECT = `SELECT p.*, v.vendor_name, v.gstin, v.state AS vendor_state, v.address AS vendor_address,
    (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS line_count,
    (SELECT COALESCE(SUM(l.line_total),0) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS po_total,
    (SELECT COALESCE(SUM(l.taxable_value),0) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS taxable_value,
    (SELECT COALESCE(SUM(l.qty_ordered - l.qty_received),0) FROM purchase_order_lines l WHERE l.po_id=p.po_id) AS qty_pending
    FROM purchase_orders p LEFT JOIN vendors v ON v.vendor_id=p.vendor_id`;

function getPo(id, companyId) {
  const po = db.prepare(PO_SELECT + ` WHERE p.po_id=? AND p.company_id=?`).get(id, companyId);
  if (!po) return null;
  const lines = db.prepare(`SELECT l.*, i.sku, i.item_name, i.avg_cost_rate
      FROM purchase_order_lines l JOIN items i ON i.item_id=l.item_id WHERE l.po_id=?`).all(po.po_id);
  const totals = computeTotals(lines.map(l => {
    const gross = round2(l.qty_ordered * l.rate);
    const discount = round2(gross * (l.discount_pct || 0) / 100);
    return {
      gross, discount, weight: l.weight || 0,
      taxable: l.taxable_value, cgst: l.cgst_amount, sgst: l.sgst_amount, igst: l.igst_amount,
    };
  }), (po.other_charges || 0) + (po.freight_charges || 0) + (po.packing_charges || 0) + (po.insurance_charges || 0), po.discount_amount || 0);
  totals.freight_charges = po.freight_charges || 0;
  totals.packing_charges = po.packing_charges || 0;
  totals.insurance_charges = po.insurance_charges || 0;
  const paymentStatus = Number(po.amount_paid) >= totals.grand_total ? 'PAID'
    : Number(po.amount_paid) > 0 ? 'PARTIAL' : 'UNPAID';
  const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(companyId);
  let customFields = [];
  try { customFields = po.custom_fields ? JSON.parse(po.custom_fields) : []; } catch (e) {}
  return {
    ...po,
    custom_fields: customFields,
    lines,
    totals,
    amount_in_words: numberToWordsINR(totals.grand_total),
    payment_status: paymentStatus,
    company,
  };
}

router.get('/purchase/next-no', (req, res) => res.json({ next_no: nextPoNo() }));

router.get('/purchase', (req, res) => {
  const { status = '', search = '' } = req.query;
  let sql = PO_SELECT + ` WHERE p.company_id=?`;
  const params = [req.companyId];
  if (status) { sql += ` AND p.status=?`; params.push(status); }
  if (search) { sql += ` AND (p.po_no LIKE ? OR v.vendor_name LIKE ? OR p.vendor_invoice_no LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ` ORDER BY p.po_id DESC LIMIT 300`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({
    ...r,
    payment_status: Number(r.amount_paid) >= r.po_total ? 'PAID' : Number(r.amount_paid) > 0 ? 'PARTIAL' : 'UNPAID',
  })));
});

router.get('/purchase/:id', (req, res) => {
  const po = getPo(req.params.id, req.companyId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(po);
});

router.post('/purchase', (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.lines) || b.lines.length === 0) return res.status(400).json({ error: 'PO needs at least one line' });

  let vendor = null;
  if (b.vendor_id) {
    vendor = db.prepare('SELECT * FROM vendors WHERE vendor_id=? AND company_id=?').get(b.vendor_id, req.companyId);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  }
  const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(req.companyId);
  const same = isSameState(b.vendor_state || vendor?.state, company.state);

  const tx = db.transaction(() => {
    let poNo = b.po_no ? String(b.po_no).trim() : '';
    if (!poNo) poNo = nextPoNo();
    const customFields = b.custom_fields && Array.isArray(b.custom_fields) ? JSON.stringify(b.custom_fields) : null;
    const info = db.prepare(`INSERT INTO purchase_orders
        (company_id, po_no, vendor_id, vendor_invoice_no, po_date, due_date, place_of_supply,
         payment_terms, reference_no, status, payment_status, amount_paid, notes, remarks,
         transport_mode, vehicle_no, delivery_date, reverse_charge, eway_bill_no,
         order_date, challan_no, other_charges,
         custom_fields, discount_amount, freight_charges, packing_charges, insurance_charges)
        VALUES (?,?,?,?,?,?,?,?,?, 'PENDING', 'UNPAID', 0, ?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?)`)
      .run(
        req.companyId, poNo, vendor?.vendor_id || null, b.vendor_invoice_no || null,
        b.po_date || now(), b.due_date || null, b.place_of_supply || null,
        b.payment_terms || null, b.reference_no || null, b.notes || null, b.remarks || null,
        b.transport_mode || null, b.vehicle_no || null, b.delivery_date || null,
        b.reverse_charge ? 1 : 0, b.eway_bill_no || null, b.order_date || null,
        b.challan_no || null, Number(b.other_charges) || 0,
        customFields, Number(b.discount_amount) || 0, Number(b.freight_charges) || 0,
        Number(b.packing_charges) || 0, Number(b.insurance_charges) || 0
      );
    const poId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO purchase_order_lines
        (po_id, item_id, qty_ordered, qty_received, rate, gst_pct, hsn_code, unit, weight, discount_pct,
         taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
        VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of b.lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(l.item_id, req.companyId);
      if (!item) throw new Error(`Item #${l.item_id} not found`);
      if (Number(l.qty_ordered) <= 0) throw new Error(`Line for ${item.sku} needs qty > 0`);
      const calc = computeLine({ qty: l.qty_ordered, rate: l.rate, gst_pct: l.gst_pct, discount_pct: l.discount_pct }, same);
      ins.run(poId, item.item_id, Number(l.qty_ordered), Number(l.rate), Number(l.gst_pct) || 0,
        item.hsn_code, item.unit, Number(l.weight) || 0, Number(l.discount_pct) || 0,
        calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total);
    }
    return poId;
  });

  try {
    const poId = tx();
    res.status(201).json(getPo(poId, req.companyId));
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'PO number already exists' });
    res.status(400).json({ error: e.message });
  }
});

router.patch('/purchase/:id', (req, res) => {
  const po = getPo(req.params.id, req.companyId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const b = req.body;
  const tx = db.transaction(() => {
    const customFields = b.custom_fields && Array.isArray(b.custom_fields) ? JSON.stringify(b.custom_fields) : null;
    db.prepare(`UPDATE purchase_orders SET
        vendor_invoice_no=?, due_date=?, place_of_supply=?, payment_terms=?, reference_no=?, notes=?, remarks=?,
        amount_paid=?, transport_mode=?, vehicle_no=?, delivery_date=?, reverse_charge=?,
        eway_bill_no=?, order_date=?, challan_no=?, other_charges=?,
        custom_fields=?, discount_amount=?, freight_charges=?, packing_charges=?, insurance_charges=?
        WHERE po_id=?`)
      .run(
        b.vendor_invoice_no ?? po.vendor_invoice_no, b.due_date ?? po.due_date,
        b.place_of_supply ?? po.place_of_supply, b.payment_terms ?? po.payment_terms,
        b.reference_no ?? po.reference_no, b.notes ?? po.notes, b.remarks ?? po.remarks,
        b.amount_paid !== undefined ? round2(Number(b.amount_paid) || 0) : po.amount_paid,
        b.transport_mode ?? po.transport_mode, b.vehicle_no ?? po.vehicle_no,
        b.delivery_date ?? po.delivery_date, b.reverse_charge !== undefined ? (b.reverse_charge ? 1 : 0) : po.reverse_charge,
        b.eway_bill_no ?? po.eway_bill_no, b.order_date ?? po.order_date,
        b.challan_no ?? po.challan_no, b.other_charges !== undefined ? Number(b.other_charges) || 0 : po.other_charges,
        customFields !== null ? customFields : (po.custom_fields || null),
        b.discount_amount !== undefined ? Number(b.discount_amount) || 0 : po.discount_amount,
        b.freight_charges !== undefined ? Number(b.freight_charges) || 0 : po.freight_charges,
        b.packing_charges !== undefined ? Number(b.packing_charges) || 0 : po.packing_charges,
        b.insurance_charges !== undefined ? Number(b.insurance_charges) || 0 : po.insurance_charges,
        po.po_id
      );
  });
  try {
    tx();
    res.json(getPo(req.params.id, req.companyId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/purchase/:id/receive', (req, res) => {
  const po = getPo(req.params.id, req.companyId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'CANCELLED') return res.status(400).json({ error: 'PO is cancelled' });

  const receives = req.body.lines || []; // [{line_id, qty_received}]
  const tx = db.transaction(() => {
    const getLine = db.prepare('SELECT * FROM purchase_order_lines WHERE po_line_id=? AND po_id=?');
    const updLine = db.prepare('UPDATE purchase_order_lines SET qty_received=? WHERE po_line_id=?');

    for (const r of receives) {
      const line = getLine.get(r.line_id, po.po_id);
      if (!line) throw new Error(`Line #${r.line_id} not found on this PO`);
      const newReceived = round2(line.qty_received + Number(r.qty_received));
      if (newReceived > line.qty_ordered) throw new Error(`Receiving more than ordered on line #${r.line_id}`);
      if (Number(r.qty_received) > 0) {
        /* GST stays separate (claimable as ITC): stock valued at net taxable rate only */
        const netRate = round2(line.rate * (1 - (line.discount_pct || 0) / 100));
        const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(line.item_id);
        postStockTransaction({
          item_id: line.item_id,
          txn_type: 'PURCHASE_IN',
          qty: Number(r.qty_received),
          rate: netRate,
          reference_type: 'PURCHASE_ORDER',
          reference_id: po.po_id,
          txn_date: req.body.receive_date || po.po_date || now(),
          remarks: `Purchase entry against ${po.po_no} (${item.sku})`,
        });
      }
      updLine.run(newReceived, line.po_line_id);
    }

    const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE po_id=?').all(po.po_id);
    const allReceived = lines.length > 0 && lines.every(l => l.qty_received >= l.qty_ordered);
    const anyReceived = lines.some(l => l.qty_received > 0);
    const status = allReceived ? 'RECEIVED' : (anyReceived ? 'PARTIAL' : 'PENDING');
    db.prepare('UPDATE purchase_orders SET status=? WHERE po_id=?').run(status, po.po_id);
    return status;
  });

  try {
    const status = tx();
    res.json({ ...getPo(req.params.id, req.companyId), status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/purchase/:id/cancel', (req, res) => {
  const po = getPo(req.params.id, req.companyId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'RECEIVED') return res.status(400).json({ error: 'Cannot cancel a fully received PO' });
  db.prepare(`UPDATE purchase_orders SET status='CANCELLED' WHERE po_id=?`).run(po.po_id);
  res.json(getPo(req.params.id, req.companyId));
});

export default router;
