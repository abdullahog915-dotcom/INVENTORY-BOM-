import { Router } from 'express';
import { db, now } from '../db.js';
import { postStockTransaction, round2 } from '../ledger.js';
import { computeLine, computeTotals, isSameState, numberToWordsINR } from '../invoice.js';

const router = Router();

const STATUSES = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'];

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT invoice_no FROM sales_invoices ORDER BY invoice_id DESC LIMIT 1').get();
  let seq = 1;
  if (row) {
    const m = row.invoice_no.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

const INVOICE_SELECT = `SELECT si.*,
  (SELECT COUNT(*) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS line_count,
  (SELECT SUM(l.qty) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS total_qty,
  (SELECT COALESCE(SUM(l.line_total),0) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS invoice_total,
  (SELECT COALESCE(SUM(l.taxable_value),0) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS taxable_value,
  (SELECT COALESCE(SUM(l.cgst_amount + l.sgst_amount + l.igst_amount),0) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS gst_value
  FROM sales_invoices si`;

const DERIVED = `CASE WHEN si.status='SENT' AND si.due_date IS NOT NULL AND date(si.due_date) < date('now') THEN 'OVERDUE' ELSE si.status END`;

router.get('/next-no', (req, res) => res.json({ next_no: nextInvoiceNo() }));

router.get('/sales', (req, res) => {
  const { search = '', status = '' } = req.query;
  let sql = INVOICE_SELECT + ` WHERE si.company_id=?`;
  const params = [req.companyId];
  if (status) { sql += ` AND (${DERIVED})=?`; params.push(status); }
  if (search) { sql += ` AND (si.invoice_no LIKE ? OR si.customer_name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY si.invoice_id DESC LIMIT 300`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...r, status: r.status === 'SENT' && r.due_date && new Date(r.due_date) < new Date() ? 'OVERDUE' : r.status })));
});

function getInvoice(id, companyId) {
  const inv = db.prepare(INVOICE_SELECT + ` WHERE si.invoice_id=? AND si.company_id=?`).get(id, companyId);
  if (!inv) return null;
  const lines = db.prepare(`SELECT l.*, i.sku, i.item_name, i.avg_cost_rate
      FROM sales_invoice_lines l JOIN items i ON i.item_id=l.item_id WHERE l.invoice_id=?`).all(inv.invoice_id);
  const returns = db.prepare(`SELECT r.*, i.sku, i.item_name FROM sales_returns r
      JOIN items i ON i.item_id=r.item_id WHERE r.invoice_id=? ORDER BY r.return_id DESC`).all(inv.invoice_id);
  const cogs = lines.reduce((s, l) => s + (l.qty - l.qty_returned) * l.avg_cost_rate, 0);
  const totals = computeTotals(lines.map(l => {
    const gross = round2(l.qty * l.rate);
    const discount = round2(gross * (l.discount_pct || 0) / 100);
    return {
      gross, discount, weight: l.weight || 0,
      taxable: l.taxable_value, cgst: l.cgst_amount, sgst: l.sgst_amount, igst: l.igst_amount,
    };
  }), (inv.other_charges || 0) + (inv.freight_charges || 0) + (inv.packing_charges || 0) + (inv.insurance_charges || 0), inv.discount_amount || 0);
  totals.freight_charges = inv.freight_charges || 0;
  totals.packing_charges = inv.packing_charges || 0;
  totals.insurance_charges = inv.insurance_charges || 0;
  let customFields = [];
  try { customFields = inv.custom_fields ? JSON.parse(inv.custom_fields) : []; } catch (e) {}
  return {
    ...inv,
    custom_fields: customFields,
    status: inv.status === 'SENT' && inv.due_date && new Date(inv.due_date) < new Date() ? 'OVERDUE' : inv.status,
    lines,
    returns,
    cogs_value: round2(cogs),
    gross_profit: round2((inv.taxable_value || totals.taxable) - cogs),
    totals,
    amount_in_words: numberToWordsINR(totals.grand_total),
  };
}

router.get('/sales/outstanding', (req, res) => {
  const { customer = '' } = req.query;
  if (!customer) return res.json({ outstanding: 0, paid: 0, total: 0 });
  const rows = db.prepare(`SELECT si.invoice_total, si.amount_paid, si.status,
      si.discount_amount, si.freight_charges, si.packing_charges, si.insurance_charges, si.other_charges,
      (SELECT COALESCE(SUM(l.taxable_value),0) FROM sales_invoice_lines l WHERE l.invoice_id=si.invoice_id) AS taxable_value
      FROM sales_invoices si WHERE si.company_id=? AND si.customer_name=? AND si.status != 'CANCELLED'`)
    .all(req.companyId, customer);
  let total = 0, paid = 0;
  for (const r of rows) {
    const grand = ((r.taxable_value || 0) - (r.discount_amount || 0)) + (r.freight_charges || 0) + (r.packing_charges || 0) + (r.insurance_charges || 0) + (r.other_charges || 0) +
      (r.status === 'DRAFT' ? 0 : r.other_charges || 0); // GST computed server-side; approximate for balance
    total += grand;
    paid += Number(r.amount_paid) || 0;
  }
  res.json({ outstanding: round2(total - paid), paid: round2(paid), total: round2(total) });
});

router.get('/sales/:id', (req, res) => {
  const inv = getInvoice(req.params.id, req.companyId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(req.companyId);
  const customer = db.prepare('SELECT contact_no FROM customers WHERE customer_name=? AND company_id=?')
    .get(inv.customer_name, req.companyId);
  res.json({ ...inv, company, customer_phone: customer?.contact_no || '' });
});

router.post('/sales', (req, res) => {
  const b = req.body;
  if (!b.customer_name) return res.status(400).json({ error: 'customer_name required' });
  if (!Array.isArray(b.lines) || b.lines.length === 0) return res.status(400).json({ error: 'Invoice needs at least one line' });

  const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(req.companyId);
  const same = isSameState(b.customer_state, company.state);

  const tx = db.transaction(() => {
    for (const l of b.lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(l.item_id, req.companyId);
      if (!item) throw new Error(`Item #${l.item_id} not found`);
      if (Number(l.qty) <= 0) throw new Error(`Line for ${item.sku} needs qty > 0`);
    }
    let invoiceNo = b.invoice_no ? String(b.invoice_no).trim() : '';
    if (!invoiceNo) invoiceNo = nextInvoiceNo();
    const customFields = b.custom_fields && Array.isArray(b.custom_fields) ? JSON.stringify(b.custom_fields) : null;
    const info = db.prepare(`INSERT INTO sales_invoices
        (company_id, invoice_no, customer_name, customer_gstin, customer_state, billing_address, shipping_address,
         place_of_supply, invoice_date, due_date, payment_terms, po_reference,
         terms_conditions, notes, authorized_signatory, remarks,
         transport_mode, vehicle_no, delivery_date, reverse_charge, eway_bill_no,
         order_date, challan_no, salesperson_name, other_charges, amount_paid,
         payment_status, copy_type, irn_no, ack_no, ack_date,
         custom_fields, shipping_name, shipping_gstin, shipping_state, shipping_contact,
         discount_amount, freight_charges, packing_charges, insurance_charges,
         status, stock_posted)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?,?, 'DRAFT', 0)`)
      .run(
        req.companyId, invoiceNo, b.customer_name.trim(), b.customer_gstin || null,
        b.customer_state || null, b.billing_address || null, b.shipping_address || null,
        b.place_of_supply || null, b.invoice_date || now(), b.due_date || null,
        b.payment_terms || null, b.po_reference || null,
        b.terms_conditions || company.invoice_terms || null, b.notes || null,
        b.authorized_signatory || null, b.remarks || null,
        b.transport_mode || null, b.vehicle_no || null, b.delivery_date || null,
        b.reverse_charge ? 1 : 0, b.eway_bill_no || null, b.order_date || null,
        b.challan_no || null, b.salesperson_name || null,
        Number(b.other_charges) || 0,
        Number(b.amount_paid) || 0, b.payment_status || 'UNPAID', b.copy_type || 'Original for Recipient',
        b.irn_no || null, b.ack_no || null, b.ack_date || null,
        customFields, b.shipping_name || null, b.shipping_gstin || null,
        b.shipping_state || null, b.shipping_contact || null,
        Number(b.discount_amount) || 0, Number(b.freight_charges) || 0,
        Number(b.packing_charges) || 0, Number(b.insurance_charges) || 0
      );
    const invId = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO sales_invoice_lines
        (invoice_id, item_id, qty, qty_returned, rate, gst_pct, hsn_code, unit, weight, discount_pct,
         taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
        VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of b.lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.item_id);
      const calc = computeLine(l, same);
      ins.run(invId, item.item_id, Number(l.qty), Number(l.rate), Number(l.gst_pct) || 0,
        item.hsn_code, item.unit, Number(l.weight) || 0, Number(l.discount_pct) || 0,
        calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total);
    }
    return invId;
  });

  try {
    const invId = tx();
    res.status(201).json(getInvoice(invId, req.companyId));
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'Invoice number already exists' });
    res.status(400).json({ error: e.message });
  }
});

router.put('/sales/:id', (req, res) => {
  const inv = getInvoice(req.params.id, req.companyId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT invoices can be edited' });

  const b = req.body;
  if (!b.customer_name) return res.status(400).json({ error: 'customer_name required' });
  if (!Array.isArray(b.lines) || b.lines.length === 0) return res.status(400).json({ error: 'Invoice needs at least one line' });

  const company = db.prepare('SELECT * FROM companies WHERE company_id=?').get(req.companyId);
  const same = isSameState(b.customer_state, company.state);

  const tx = db.transaction(() => {
    for (const l of b.lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=? AND company_id=?').get(l.item_id, req.companyId);
      if (!item) throw new Error(`Item #${l.item_id} not found`);
      if (Number(l.qty) <= 0) throw new Error(`Line for ${item.sku} needs qty > 0`);
    }

    const customFields = b.custom_fields && Array.isArray(b.custom_fields) ? JSON.stringify(b.custom_fields) : null;
    db.prepare(`UPDATE sales_invoices SET
        customer_name=?, customer_gstin=?, customer_state=?, billing_address=?, shipping_address=?,
        place_of_supply=?, invoice_date=?, due_date=?, payment_terms=?, po_reference=?,
        terms_conditions=?, notes=?, authorized_signatory=?, remarks=?,
        transport_mode=?, vehicle_no=?, delivery_date=?, reverse_charge=?, eway_bill_no=?,
        order_date=?, challan_no=?, salesperson_name=?, other_charges=?, amount_paid=?,
        payment_status=?, copy_type=?, irn_no=?, ack_no=?, ack_date=?,
        custom_fields=?, shipping_name=?, shipping_gstin=?, shipping_state=?, shipping_contact=?,
        discount_amount=?, freight_charges=?, packing_charges=?, insurance_charges=?
        WHERE invoice_id=? AND company_id=?`)
      .run(
        b.customer_name.trim(), b.customer_gstin || null, b.customer_state || null,
        b.billing_address || null, b.shipping_address || null, b.place_of_supply || null,
        b.invoice_date || inv.invoice_date, b.due_date || null, b.payment_terms || null,
        b.po_reference || null, b.terms_conditions || company.invoice_terms || null,
        b.notes || null, b.authorized_signatory || null, b.remarks || null,
        b.transport_mode || null, b.vehicle_no || null, b.delivery_date || null,
        b.reverse_charge ? 1 : 0, b.eway_bill_no || null, b.order_date || null,
        b.challan_no || null, b.salesperson_name || null, Number(b.other_charges) || 0,
        Number(b.amount_paid) || 0, b.payment_status || 'UNPAID', b.copy_type || 'Original for Recipient',
        b.irn_no || null, b.ack_no || null, b.ack_date || null,
        customFields, b.shipping_name || null, b.shipping_gstin || null,
        b.shipping_state || null, b.shipping_contact || null,
        Number(b.discount_amount) || 0, Number(b.freight_charges) || 0,
        Number(b.packing_charges) || 0, Number(b.insurance_charges) || 0,
        inv.invoice_id, req.companyId
      );

    db.prepare('DELETE FROM sales_invoice_lines WHERE invoice_id=?').run(inv.invoice_id);

    const ins = db.prepare(`INSERT INTO sales_invoice_lines
        (invoice_id, item_id, qty, qty_returned, rate, gst_pct, hsn_code, unit, weight, discount_pct,
         taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
        VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of b.lines) {
      const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.item_id);
      const calc = computeLine(l, same);
      ins.run(inv.invoice_id, item.item_id, Number(l.qty), Number(l.rate), Number(l.gst_pct) || 0,
        item.hsn_code, item.unit, Number(l.weight) || 0, Number(l.discount_pct) || 0,
        calc.taxable, calc.cgst, calc.sgst, calc.igst, calc.line_total);
    }
  });

  try {
    tx();
    res.json(getInvoice(inv.invoice_id, req.companyId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function transitionStatus(inv, newStatus, companyId) {
  if (inv.status === 'CANCELLED') throw new Error('Invoice is cancelled');

  const lineStmt = db.prepare('SELECT * FROM sales_invoice_lines WHERE invoice_id=?');
  const ret = db.prepare('SELECT COALESCE(SUM(qty),0) q FROM sales_returns WHERE invoice_id=?').get(inv.invoice_id);

  const tx = db.transaction(() => {
    if (newStatus === 'CANCELLED' && ret.q > 0) {
      throw new Error('Cannot cancel an invoice with returns; reverse the returns first');
    }

    if (newStatus === 'CANCELLED' && inv.stock_posted) {
      for (const l of lineStmt.all(inv.invoice_id)) {
        postStockTransaction({
          item_id: l.item_id, txn_type: 'ADJUSTMENT_IN', qty: l.qty,
          reference_type: 'SALES_INVOICE', reference_id: inv.invoice_id,
          remarks: `Reverse of cancelled invoice ${inv.invoice_no}`,
        });
      }
      db.prepare('UPDATE sales_invoices SET stock_posted=0 WHERE invoice_id=?').run(inv.invoice_id);
    }

    const needsPosted = ['SENT', 'PAID', 'OVERDUE'].includes(newStatus);
    if (needsPosted && !inv.stock_posted) {
      const lines = lineStmt.all(inv.invoice_id);
      for (const l of lines) {
        const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(l.item_id);
        if (item.current_stock_qty < l.qty) {
          throw new Error(`Insufficient stock for ${item.sku}: available ${item.current_stock_qty} ${item.unit}, selling ${l.qty}`);
        }
      }
      for (const l of lines) {
        postStockTransaction({
          item_id: l.item_id, txn_type: 'SALES_OUT', qty: l.qty,
          reference_type: 'SALES_INVOICE', reference_id: inv.invoice_id,
          txn_date: inv.invoice_date || now(),
          remarks: `Sale against ${inv.invoice_no}`,
        });
      }
      db.prepare('UPDATE sales_invoices SET stock_posted=1 WHERE invoice_id=?').run(inv.invoice_id);
    }

    if (newStatus === 'DRAFT' && inv.stock_posted) {
      for (const l of lineStmt.all(inv.invoice_id)) {
        postStockTransaction({
          item_id: l.item_id, txn_type: 'ADJUSTMENT_IN', qty: l.qty,
          reference_type: 'SALES_INVOICE', reference_id: inv.invoice_id,
          remarks: `Back to draft ${inv.invoice_no}`,
        });
      }
      db.prepare('UPDATE sales_invoices SET stock_posted=0 WHERE invoice_id=?').run(inv.invoice_id);
    }

    db.prepare('UPDATE sales_invoices SET status=? WHERE invoice_id=?').run(newStatus, inv.invoice_id);
  });
  tx();
  return getInvoice(inv.invoice_id, companyId);
}

router.patch('/sales/:id/status', (req, res) => {
  const inv = getInvoice(req.params.id, req.companyId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const newStatus = String(req.body.status || '').toUpperCase();
  if (!STATUSES.includes(newStatus)) return res.status(400).json({ error: `Invalid status. Use ${STATUSES.join(', ')}` });
  try {
    res.json(transitionStatus(inv, newStatus, req.companyId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/sales/:id/return', (req, res) => {
  const inv = getInvoice(req.params.id, req.companyId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Invoice is cancelled' });
  if (!inv.stock_posted) return res.status(400).json({ error: 'Mark invoice as SENT before recording returns (draft invoices do not affect stock)' });

  const { line_id, qty, remarks } = req.body;
  const line = db.prepare('SELECT * FROM sales_invoice_lines WHERE line_id=? AND invoice_id=?').get(line_id, inv.invoice_id);
  if (!line) return res.status(404).json({ error: 'Invoice line not found' });
  const returnQty = Number(qty);
  if (!(returnQty > 0)) return res.status(400).json({ error: 'Return qty must be > 0' });
  if (line.qty_returned + returnQty > line.qty) {
    return res.status(400).json({ error: `Return exceeds sold qty (sold ${line.qty}, already returned ${line.qty_returned})` });
  }

  const tx = db.transaction(() => {
    postStockTransaction({
      item_id: line.item_id, txn_type: 'SALES_RETURN_IN', qty: returnQty,
      reference_type: 'SALES_INVOICE', reference_id: inv.invoice_id,
      txn_date: req.body.return_date || now(),
      remarks: `Return against ${inv.invoice_no}`,
    });
    db.prepare('UPDATE sales_invoice_lines SET qty_returned=? WHERE line_id=?')
      .run(round2(line.qty_returned + returnQty), line_id);
    db.prepare(`INSERT INTO sales_returns (company_id, invoice_id, item_id, qty, rate, return_date, remarks)
        VALUES (?,?,?,?,?,?,?)`)
      .run(req.companyId, inv.invoice_id, line.item_id, returnQty, line.rate, req.body.return_date || now(), remarks || null);
  });

  try {
    tx();
    res.json(getInvoice(req.params.id, req.companyId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/sales/:id/cancel', (req, res) => {
  const inv = getInvoice(req.params.id, req.companyId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  try {
    res.json(transitionStatus(inv, 'CANCELLED', req.companyId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
