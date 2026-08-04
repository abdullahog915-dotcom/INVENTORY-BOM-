import React, { useState } from 'react';
import { api } from '../api.js';
import { Button, Input, Select, useToast } from './ui.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES } from '../constants.js';
import { parseBankDetails, stringifyBankDetails, parseInvoiceTerms, stringifyInvoiceTerms } from '../utils.js';
import { ALL_FIELDS, FIELD_SECTIONS, defaultVisibleKeys, parseFieldDefaults } from '../fieldCatalog.js';

/** Full editable profile form for a single company (logo, GSTIN, PAN, address,
    bank details, invoice terms, invoice field defaults). Saves via PUT
    /api/companies/:id, which is id-based and not scoped to the active company,
    so this can edit any company. Reused by Settings (active company) and the
    Companies management screen. */
export default function CompanyProfileForm({ company, onSaved }) {
  const { refreshCompanies } = useCompany();
  const [form, setForm] = useState(() => (company ? { ...company } : null));
  const [bank, setBank] = useState(() => parseBankDetails(company?.bank_details));
  const [terms, setTerms] = useState(() => parseInvoiceTerms(company?.invoice_terms));
  const [fieldSelections, setFieldSelections] = useState(() => new Set(parseFieldDefaults(company?.field_defaults) || defaultVisibleKeys()));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (!form) return null;

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setBankField = (k, v) => setBank(b => ({ ...b, [k]: v }));

  const updateTerm = (idx, val) => {
    setTerms(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };
  const addTerm = () => setTerms(prev => [...prev, '']);
  const removeTerm = (idx) => setTerms(prev => prev.filter((_, i) => i !== idx));

  const toggleDefaultField = (key) => {
    setFieldSelections(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  /* ---- Company logo upload (file -> base64) with size check & compression ---- */
  const MAX_LOGO_BYTES = 1024 * 1024; // 1MB
  const MAX_LOGO_DIM = 300;           // max width/height in px

  const onLogoChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast('Logo too large — please choose an image under 1MB', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        if (file.size <= 100 * 1024 && img.width <= MAX_LOGO_DIM && img.height <= MAX_LOGO_DIM) {
          setField('logo', dataUrl);
          return;
        }
        const scale = Math.min(1, MAX_LOGO_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        setField('logo', canvas.toDataURL('image/png'));
      };
      img.onerror = () => toast('Could not read that image file', 'error');
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  /* ---- State code preview ---- */
  const stateCodePreview = (() => {
    const state = form.state || '';
    const map = { 'ANDHRA PRADESH':'AP','ARUNACHAL PRADESH':'AR','ASSAM':'AS','BIHAR':'BR','CHHATTISGARH':'CG','GOA':'GA','GUJARAT':'GJ','HARYANA':'HR','HIMACHAL PRADESH':'HP','JHARKHAND':'JH','KARNATAKA':'KA','KERALA':'KL','MADHYA PRADESH':'MP','MAHARASHTRA':'MH','MANIPUR':'MN','MEGHALAYA':'ML','MIZORAM':'MZ','NAGALAND':'NL','ODISHA':'OD','PUNJAB':'PB','RAJASTHAN':'RJ','SIKKIM':'SK','TAMIL NADU':'TN','TELANGANA':'TS','TRIPURA':'TR','UTTAR PRADESH':'UP','UTTARAKHAND':'UK','WEST BENGAL':'WB','ANDAMAN AND NICOBAR ISLANDS':'AN','CHANDIGARH':'CH','DADRA AND NAGAR HAVELI AND DAMAN AND DIU':'DD','DELHI':'DL','JAMMU AND KASHMIR':'JK','LADAKH':'LA','LAKSHADWEEP':'LD','PUDUCHERRY':'PY' };
    return state ? `${state} (${map[state.toUpperCase()] || ''})` : '';
  })();

  const save = async () => {
    if (!form.name.trim()) { toast('Company name required', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        bank_details: stringifyBankDetails(bank),
        invoice_terms: stringifyInvoiceTerms(terms),
        field_defaults: Array.from(fieldSelections),
      };
      await api(`/companies/${form.company_id}`, { method: 'PUT', body: payload });
      await refreshCompanies();
      toast('Company profile updated successfully');
      onSaved && onSaved(form);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 mb-3">
        {form.logo ? (
          <img src={form.logo} alt="Company Logo" className="h-20 w-20 object-contain border border-slate-200 rounded-lg bg-white" />
        ) : <div className="h-20 w-20 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-[10px] text-slate-400 bg-slate-50">Logo</div>}
        <label className="flex-1">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Company Logo (Print on Invoice)</span>
          <div className="flex gap-2 items-center">
            <input type="file" accept="image/*" onChange={onLogoChange}
              className="block w-full text-xs text-slate-500 file:mr-2 file:px-2.5 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
            {form.logo && (
              <Button size="xs" variant="secondary" onClick={() => setField('logo', '')}>Remove</Button>
            )}
          </div>
          <span className="block text-[11px] text-slate-400 mt-1">PNG/JPG recommended, max 1MB. Shown on top-left of GST invoice.</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Input label="Company Name *" value={form.name || ''} onChange={e => setField('name', e.target.value)} />
        <Input label="GSTIN" value={form.gstin || ''} onChange={e => setField('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" />
        <Input label="PAN Number" value={form.pan || ''} onChange={e => setField('pan', e.target.value)} placeholder="AAAAA0000A" />
        <Select label="State" value={form.state || ''} onChange={e => setField('state', e.target.value)}>
          <option value="">Select state...</option>
          {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        {stateCodePreview && <div className="flex items-end pb-1 text-xs font-semibold text-emerald-700">{stateCodePreview}</div>}
        <Input label="Phone / Mobile No" value={form.phone || ''} onChange={e => setField('phone', e.target.value)} placeholder="+91 9876543210" />
        <Input label="Email Address" value={form.email || ''} onChange={e => setField('email', e.target.value)} placeholder="info@company.com" />
        <Input label="Website" value={form.website || ''} onChange={e => setField('website', e.target.value)} placeholder="www.company.com" />
        <Input label="UPI ID (For Invoice QR Code)" value={form.upi_id || ''} onChange={e => setField('upi_id', e.target.value)} placeholder="merchant@upi" />
        <Input label="Jurisdiction Clause" value={form.jurisdiction || ''} onChange={e => setField('jurisdiction', e.target.value)} placeholder="Subject to Moradabad Jurisdiction" />
        <Input label="Address" value={form.address || ''} onChange={e => setField('address', e.target.value)} placeholder="Full office/factory address" className="sm:col-span-2 lg:col-span-3" />
      </div>

      {/* Bank Details */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Bank Account Details (Printed on Invoice)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input label="Bank Name" value={bank.bank_name || ''} onChange={e => setBankField('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
          <Input label="Account Number" value={bank.account_no || ''} onChange={e => setBankField('account_no', e.target.value)} placeholder="e.g. 50100123456789" />
          <Input label="IFSC Code" value={bank.ifsc || ''} onChange={e => setBankField('ifsc', e.target.value)} placeholder="e.g. HDFC0001234" />
          <Input label="Branch Name" value={bank.branch || ''} onChange={e => setBankField('branch', e.target.value)} placeholder="e.g. Moradabad Branch" />
          <Input label="Account Holder Name" value={bank.holder_name || ''} onChange={e => setBankField('holder_name', e.target.value)} placeholder="e.g. Craft Exports" className="sm:col-span-2 lg:col-span-2" />
        </div>
      </div>

      {/* Terms & Conditions */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Invoice Terms & Conditions</h4>
          <Button size="xs" variant="secondary" onClick={addTerm}>+ Add Term</Button>
        </div>
        <div className="space-y-2">
          {terms.map((term, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}.</span>
              <Input value={term} onChange={e => updateTerm(i, e.target.value)} placeholder={`Term #${i + 1}`} className="flex-1" />
              {terms.length > 1 && (
                <button type="button" onClick={() => removeTerm(i)} className="text-rose-500 hover:text-rose-700 p-1 text-sm font-bold cursor-pointer" title="Remove term">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invoice Field Defaults (company template for new invoices) */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Invoice Field Defaults</h4>
          <div className="flex gap-1.5">
            <Button size="xs" variant="secondary" onClick={() => setFieldSelections(new Set(defaultVisibleKeys()))}>Reset All</Button>
            <Button size="xs" variant="secondary" onClick={() => setFieldSelections(new Set())}>Clear All</Button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mb-2">
          Tick which fields should be visible by default on new invoices. This is saved as the company template.
          You can still change fields per-invoice from the Fields button inside each invoice.
        </p>
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {FIELD_SECTIONS.map(section => {
            const fields = ALL_FIELDS.filter(f => f.section === section.id);
            if (fields.length === 0) return null;
            return (
              <div key={section.id}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{section.icon} {section.label}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                  {fields.map(f => (
                    <label key={f.key} className="flex items-start gap-1.5 cursor-pointer text-[11px] text-slate-600 leading-tight">
                      <input type="checkbox" checked={fieldSelections.has(f.key)} onChange={() => toggleDefaultField(f.key)}
                        className="mt-0.5 w-3.5 h-3.5 rounded text-indigo-600" />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{fieldSelections.size} of {ALL_FIELDS.length} fields visible by default</span>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Company Details'}
        </Button>
      </div>
    </div>
  );
}
