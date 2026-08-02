import React, { useState } from 'react';
import { api } from '../api.js';
import { PageHeader, Card, Input, Select, Button, Spinner, ConfirmText, useToast } from '../components/ui.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES } from '../constants.js';

const field = (name, label, company, set) => (
  <Input label={label} value={company[name] || ''} onChange={e => set(name, e.target.value)} />
);

export default function Settings() {
  const { companies, current, switchCompany, refreshCompanies } = useCompany();
  const [company, setCompany] = useState(current);
  const [savingCompany, setSavingCompany] = useState(false);
  const [newName, setNewName] = useState('');
  const [seedDemo, setSeedDemo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resetMode, setResetMode] = useState('reseed');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  if (!current) return <Spinner label="Loading..." />;

  const setField = (k, v) => setCompany(c => ({ ...c, [k]: v }));

  const saveCompany = async () => {
    if (!company.name.trim()) { toast('Company name required', 'error'); return; }
    setSavingCompany(true);
    try {
      await api(`/companies/${company.company_id}`, { method: 'PUT', body: company });
      await refreshCompanies();
      toast('Company details saved');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingCompany(false); }
  };

  const createCompany = async () => {
    if (!newName.trim()) { toast('Company name required', 'error'); return; }
    setCreating(true);
    try {
      const c = await api('/companies', { method: 'POST', body: { name: newName, seed_demo: seedDemo } });
      await refreshCompanies();
      switchCompany(c.company_id);
      setNewName(''); setSeedDemo(false);
      toast('Company created' + (seedDemo ? ' with demo data' : ''));
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
    <div className="max-w-3xl">
      <PageHeader title="Settings / सेटिंग्स" subtitle="Company profile, multi-company management and data tools" />

      <Card title="Current Company / वर्तमान कंपनी" className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {field('name', 'Company Name *', company, setField)}
          {field('gstin', 'GSTIN', company, setField)}
          <Select label="State / राज्य" value={company.state || ''} onChange={e => setField('state', e.target.value)}>
            <option value="">Select state...</option>
            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          {field('bank_details', 'Bank Details (shown on invoice)', company, setField)}
          <Input label="Address" value={company.address || ''} onChange={e => setField('address', e.target.value)} className="sm:col-span-2" />
          <Input label="Invoice Terms / Footer Terms" value={company.invoice_terms || ''} onChange={e => setField('invoice_terms', e.target.value)} className="sm:col-span-2" />
        </div>
        <Button variant="primary" onClick={saveCompany} disabled={savingCompany}>{savingCompany ? 'Saving...' : 'Save Company'}</Button>
      </Card>

      <Card title="Add New Company / नई कंपनी" className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Company Name *" value={newName} onChange={e => setNewName(e.target.value)} className="w-64" placeholder="e.g. Craft Exports Pvt Ltd" />
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2 cursor-pointer">
            <input type="checkbox" checked={seedDemo} onChange={e => setSeedDemo(e.target.checked)} className="w-4 h-4" />
            Seed with demo data
          </label>
          <Button variant="primary" onClick={createCompany} disabled={creating}>{creating ? 'Creating...' : 'Create Company'}</Button>
        </div>
      </Card>

      <Card title="All Companies" className="mb-4" pad={false}>
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

      <Card title="Danger Zone / डेंजर ज़ोन" danger className="border-rose-300">
        <p className="text-sm text-slate-600 mb-3">
          Reset all data for <strong>every company</strong> (items, customers, vendors, sales, purchases, production, stock ledger and BOMs).
          Company profiles are kept. This cannot be undone — you must type <span className="font-mono font-semibold">DELETE</span> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-56" value={resetMode} onChange={e => setResetMode(e.target.value)}>
            <option value="reseed">Reset &amp; reseed demo data</option>
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
