import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { PageHeader, Card, Input, Select, Button, Spinner, ConfirmText, useToast } from '../components/ui.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES } from '../constants.js';
import { parseBankDetails, stringifyBankDetails, parseInvoiceTerms, stringifyInvoiceTerms } from '../utils.js';
import { ALL_FIELDS, FIELD_SECTIONS, defaultVisibleKeys, parseFieldDefaults } from '../fieldCatalog.js';

export default function Settings() {
  const { companies, current, switchCompany, refreshCompanies } = useCompany();
  const [company, setCompany] = useState(current);
  const [bank, setBank] = useState(() => parseBankDetails(current?.bank_details));
  const [terms, setTerms] = useState(() => parseInvoiceTerms(current?.invoice_terms));
  const [savingCompany, setSavingCompany] = useState(false);

  // New company form
  const [newComp, setNewComp] = useState({ name: '', gstin: '', state: '', address: '' });
  const [newBank, setNewBank] = useState({ bank_name: '', account_no: '', ifsc: '', branch: '', holder_name: '' });
  const [newTerms, setNewTerms] = useState([
    'Goods once sold will not be taken back.',
    'Payment due within agreed credit period.',
    'Subject to local jurisdiction.'
  ]);
  const [seedDemo, setSeedDemo] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetMode, setResetMode] = useState('reseed');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  /* ---- field defaults (which fields show by default on new invoices) ---- */
  const [fieldSelections, setFieldSelections] = useState(() => {
    const defaults = parseFieldDefaults(current?.field_defaults);
    return new Set(defaults || defaultVisibleKeys());
  });
  const toggleDefaultField = (key) => {
    setFieldSelections(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  useEffect(() => {
    if (current) {
      setCompany(current);
      setBank(parseBankDetails(current.bank_details));
      setTerms(parseInvoiceTerms(current.invoice_terms));
      setFieldSelections(prev => new Set(parseFieldDefaults(current.field_defaults) || Array.from(prev)));
    }
  }, [current]);

  if (!current) return <Spinner label="Loading..." />;

  const setField = (k, v) => setCompany(c => ({ ...c, [k]: v }));
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
        // If already small enough, keep the original to avoid re-encoding.
        if (file.size <= 100 * 1024 && img.width <= MAX_LOGO_DIM && img.height <= MAX_LOGO_DIM) {
          setField('logo', dataUrl);
          return;
        }
        // Otherwise compress/resize via canvas.
        const scale = Math.min(1, MAX_LOGO_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        setField('logo', canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => toast('Could not read that image file', 'error');
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  /* ---- State code preview ---- */
  const stateCodePreview = (() => {
    const state = company.state || current.state || '';
    const map = { 'ANDHRA PRADESH':'AP','ARUNACHAL PRADESH':'AR','ASSAM':'AS','BIHAR':'BR','CHHATTISGARH':'CG','GOA':'GA','GUJARAT':'GJ','HARYANA':'HR','HIMACHAL PRADESH':'HP','JHARKHAND':'JH','KARNATAKA':'KA','KERALA':'KL','MADHYA PRADESH':'MP','MAHARASHTRA':'MH','MANIPUR':'MN','MEGHALAYA':'ML','MIZORAM':'MZ','NAGALAND':'NL','ODISHA':'OD','PUNJAB':'PB','RAJASTHAN':'RJ','SIKKIM':'SK','TAMIL NADU':'TN','TELANGANA':'TS','TRIPURA':'TR','UTTAR PRADESH':'UP','UTTARAKHAND':'UK','WEST BENGAL':'WB','ANDAMAN AND NICOBAR ISLANDS':'AN','CHANDIGARH':'CH','DADRA AND NAGAR HAVELI AND DAMAN AND DIU':'DD','DELHI':'DL','JAMMU AND KASHMIR':'JK','LADAKH':'LA','LAKSHADWEEP':'LD','PUDUCHERRY':'PY' };
    return state ? `${state} (${map[state.toUpperCase()] || ''})` : '';
  })();

  const saveCompany = async () => {
    if (!company.name.trim()) { toast('Company name required', 'error'); return; }
    setSavingCompany(true);
    try {
      const payload = {
        ...company,
        bank_details: stringifyBankDetails(bank),
        invoice_terms: stringifyInvoiceTerms(terms),
        field_defaults: Array.from(fieldSelections),
      };
      await api(`/companies/${company.company_id}`, { method: 'PUT', body: payload });
      await refreshCompanies();
      toast('Company profile updated successfully');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingCompany(false); }
  };

  const updateNewTerm = (idx, val) => {
    setNewTerms(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };
  const addNewTerm = () => setNewTerms(prev => [...prev, '']);
  const removeNewTerm = (idx) => setNewTerms(prev => prev.filter((_, i) => i !== idx));

  const createCompany = async () => {
    if (!newComp.name.trim()) { toast('Company name required', 'error'); return; }
    setCreating(true);
    try {
      const payload = {
        ...newComp,
        bank_details: stringifyBankDetails(newBank),
        invoice_terms: stringifyInvoiceTerms(newTerms),
        seed_demo: seedDemo,
      };
      const c = await api('/companies', { method: 'POST', body: payload });
      await refreshCompanies();
      switchCompany(c.company_id);
      setNewComp({ name: '', gstin: '', state: '', address: '' });
      setNewBank({ bank_name: '', account_no: '', ifsc: '', branch: '', holder_name: '' });
      setSeedDemo(false);
      toast('New company created successfully' + (seedDemo ? ' with demo data' : ''));
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreating(false); }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      const r = await api('/settings/reset', { method: 'POST', body: { confirm: 'DELETE', mode: resetMode } });
      await refreshCompanies();
      if (r.companies?.length) switchCompany(r.companies[0].company_id);
      toast(resetMode === 'reseed' ? 'All data reset and demo data reseeded' : 'All data cleared');
    } catch (e) { toast(e.message, 'error'); }
    finally { setResetting(false); setConfirmReset(null); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, multi-company management, bank details & invoice terms" />

      {/* Current Company */}
      <Card title="Current Company Profile">
        <div className="space-y-4">
          <div className="flex items-start gap-4 mb-3">
            {company.logo ? (
              <img src={company.logo} alt="Company Logo" className="h-20 w-20 object-contain border border-slate-200 rounded-lg bg-white" />
            ) : <div className="h-20 w-20 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-[10px] text-slate-400 bg-slate-50">Logo</div>}
            <label className="flex-1">
              <span className="block text-xs font-semibold text-slate-600 mb-1">Company Logo (Print on Invoice)</span>
              <div className="flex gap-2 items-center">
                <input type="file" accept="image/*" onChange={onLogoChange}
                  className="block w-full text-xs text-slate-500 file:mr-2 file:px-2.5 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
                {company.logo && (
                  <Button size="xs" variant="secondary" onClick={() => setField('logo', '')}>Remove</Button>
                )}
              </div>
              <span className="block text-[11px] text-slate-400 mt-1">PNG/JPG recommended, max 1MB. Shown on top-left of GST invoice.</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Input label="Company Name *" value={company.name || ''} onChange={e => setField('name', e.target.value)} />
            <Input label="GSTIN" value={company.gstin || ''} onChange={e => setField('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" />
            <Input label="PAN Number" value={company.pan || ''} onChange={e => setField('pan', e.target.value)} placeholder="AAAAA0000A" />
            <Select label="State" value={company.state || ''} onChange={e => setField('state', e.target.value)}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            {stateCodePreview && <div className="flex items-end pb-1 text-xs font-semibold text-emerald-700">{stateCodePreview}</div>}
            <Input label="Phone / Mobile No" value={company.phone || ''} onChange={e => setField('phone', e.target.value)} placeholder="+91 9876543210" />
            <Input label="Email Address" value={company.email || ''} onChange={e => setField('email', e.target.value)} placeholder="info@company.com" />
            <Input label="Website" value={company.website || ''} onChange={e => setField('website', e.target.value)} placeholder="www.company.com" />
            <Input label="UPI ID (For Invoice QR Code)" value={company.upi_id || ''} onChange={e => setField('upi_id', e.target.value)} placeholder="merchant@upi" />
            <Input label="Jurisdiction Clause" value={company.jurisdiction || ''} onChange={e => setField('jurisdiction', e.target.value)} placeholder="Subject to Moradabad Jurisdiction" />
            <Input label="Address" value={company.address || ''} onChange={e => setField('address', e.target.value)} placeholder="Full office/factory address" className="sm:col-span-2 lg:col-span-3" />
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
            <Button variant="primary" onClick={saveCompany} disabled={savingCompany}>
              {savingCompany ? 'Saving...' : 'Save Company Details'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Add New Company */}
      <Card title="Add New Company">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Input label="Company Name *" value={newComp.name} onChange={e => setNewComp(c => ({ ...c, name: e.target.value }))} placeholder="e.g. Craft Exports Pvt Ltd" />
            <Input label="GSTIN" value={newComp.gstin} onChange={e => setNewComp(c => ({ ...c, gstin: e.target.value }))} placeholder="Optional" />
            <Input label="PAN Number" value={newComp.pan || ''} onChange={e => setNewComp(c => ({ ...c, pan: e.target.value }))} placeholder="Optional" />
            <Select label="State" value={newComp.state} onChange={e => setNewComp(c => ({ ...c, state: e.target.value }))}>
              <option value="">Select state...</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Phone" value={newComp.phone || ''} onChange={e => setNewComp(c => ({ ...c, phone: e.target.value }))} placeholder="Optional" />
            <Input label="Email" value={newComp.email || ''} onChange={e => setNewComp(c => ({ ...c, email: e.target.value }))} placeholder="Optional" />
            <Input label="UPI ID" value={newComp.upi_id || ''} onChange={e => setNewComp(c => ({ ...c, upi_id: e.target.value }))} placeholder="Optional" />
            <Input label="Jurisdiction" value={newComp.jurisdiction || ''} onChange={e => setNewComp(c => ({ ...c, jurisdiction: e.target.value }))} placeholder="Optional" />
            <Input label="Address" value={newComp.address} onChange={e => setNewComp(c => ({ ...c, address: e.target.value }))} placeholder="Optional" className="sm:col-span-2 lg:col-span-3" />
          </div>

          {/* New Company Bank Details */}
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Bank Details (Optional)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Input label="Bank Name" value={newBank.bank_name} onChange={e => setNewBank(b => ({ ...b, bank_name: e.target.value }))} placeholder="e.g. SBI Bank" />
              <Input label="Account Number" value={newBank.account_no} onChange={e => setNewBank(b => ({ ...b, account_no: e.target.value }))} placeholder="Account No" />
              <Input label="IFSC Code" value={newBank.ifsc} onChange={e => setNewBank(b => ({ ...b, ifsc: e.target.value }))} placeholder="IFSC Code" />
              <Input label="Branch" value={newBank.branch} onChange={e => setNewBank(b => ({ ...b, branch: e.target.value }))} placeholder="Branch" />
              <Input label="Account Holder" value={newBank.holder_name} onChange={e => setNewBank(b => ({ ...b, holder_name: e.target.value }))} placeholder="Holder Name" className="sm:col-span-2 lg:col-span-2" />
            </div>
          </div>

          {/* New Company Terms */}
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Invoice Terms & Conditions</h4>
              <Button size="xs" variant="secondary" onClick={addNewTerm}>+ Add Term</Button>
            </div>
            <div className="space-y-2">
              {newTerms.map((term, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}.</span>
                  <Input value={term} onChange={e => updateNewTerm(i, e.target.value)} placeholder={`Term #${i + 1}`} className="flex-1" />
                  {newTerms.length > 1 && (
                    <button type="button" onClick={() => removeNewTerm(i)} className="text-rose-500 hover:text-rose-700 p-1 text-sm font-bold cursor-pointer" title="Remove term">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={seedDemo} onChange={e => setSeedDemo(e.target.checked)} className="w-4 h-4 rounded text-indigo-600" />
              Seed with sample items, BOM & demo data
            </label>
            <Button variant="primary" onClick={createCompany} disabled={creating}>{creating ? 'Creating...' : 'Create Company'}</Button>
          </div>
        </div>
      </Card>

      {/* All Companies List */}
      <Card title="All Companies" pad={false}>
        <div className="divide-y divide-slate-100">
          {companies.map(c => (
            <div key={c.company_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {c.name} {c.is_default ? <span className="ml-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">DEFAULT</span> : null}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{c.gstin ? `GSTIN ${c.gstin}` : 'No GSTIN'} · {c.state || 'No state'}</div>
              </div>
              {c.company_id === current.company_id
                ? <span className="text-xs text-indigo-600 font-semibold">ACTIVE</span>
                : <Button onClick={() => switchCompany(c.company_id)}>Switch</Button>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Danger Zone" danger className="border-rose-300">
        <p className="text-sm text-slate-600 mb-3">
          Reset all data for <strong>every company</strong> (items, customers, vendors, sales, purchases, production, stock ledger and BOMs).
          Company profiles are kept. This cannot be undone — you must type <span className="font-mono font-semibold">DELETE</span> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-56" value={resetMode} onChange={e => setResetMode(e.target.value)}>
            <option value="reseed">Reset & reseed demo data</option>
            <option value="empty">Reset to empty</option>
          </Select>
          <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={resetting}>{resetting ? 'Resetting...' : 'Reset All Data'}</Button>
        </div>
      </Card>

      {confirmReset && (
        <ConfirmText
          title="Reset All Data — Are you sure?"
          message={resetMode === 'reseed'
            ? 'This wipes all transactional data across every company, then re-seeds fresh demo data into the default company. Type DELETE to confirm.'
            : 'This wipes all transactional data across every company, leaving empty masters. Type DELETE to confirm.'}
          confirmText="DELETE"
          placeholder="Type DELETE to confirm"
          onCancel={() => setConfirmReset(null)}
          onConfirm={doReset}
        />
      )}
    </div>
  );
}