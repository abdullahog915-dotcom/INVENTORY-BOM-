import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { PageHeader, Card, Button, Input, Select, Modal, Badge, Spinner, ConfirmText, useToast } from '../components/ui.jsx';
import { useCompany } from '../CompanyContext.jsx';
import { INDIAN_STATES } from '../constants.js';
import { stringifyBankDetails, parseInvoiceTerms, stringifyInvoiceTerms } from '../utils.js';
import CompanyProfileForm from '../components/CompanyProfileForm.jsx';

const DEFAULT_TERMS = [
  'Goods once sold will not be taken back.',
  'Payment due within agreed credit period.',
  'Subject to local jurisdiction.'
];

export default function Companies({ createReq }) {
  const { companies, companyId, current, ready, switchCompany, refreshCompanies } = useCompany();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  /* ---- "Add New Company" form (moved from Settings) ---- */
  const [newComp, setNewComp] = useState({ name: '', gstin: '', state: '', address: '' });
  const [newBank, setNewBank] = useState({ bank_name: '', account_no: '', ifsc: '', branch: '', holder_name: '' });
  const [newTerms, setNewTerms] = useState(DEFAULT_TERMS);
  const [seedDemo, setSeedDemo] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (createReq && createReq.page === 'companies') setCreateOpen(true);
  }, [createReq]);

  /* ---- Danger zone: reset all data ---- */
  const [resetMode, setResetMode] = useState('reseed');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetting, setResetting] = useState(false);

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

  const updateNewTerm = (idx, val) => {
    setNewTerms(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };
  const addNewTerm = () => setNewTerms(prev => [...prev, '']);
  const removeNewTerm = (idx) => setNewTerms(prev => prev.filter((_, i) => i !== idx));

  const resetCreateForm = () => {
    setNewComp({ name: '', gstin: '', state: '', address: '' });
    setNewBank({ bank_name: '', account_no: '', ifsc: '', branch: '', holder_name: '' });
    setNewTerms(DEFAULT_TERMS);
    setSeedDemo(false);
  };

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
      resetCreateForm();
      setCreateOpen(false);
      toast('New company created successfully' + (seedDemo ? ' with demo data' : ''));
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreating(false); }
  };

  if (!ready) return <Spinner label="Loading companies..." />;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Companies"
        subtitle="Select a company to open it, or create / edit company profiles"
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Create New Company</Button>
        }
      />

      {/* All Companies List */}
      <Card title="All Companies" pad={false}>
        <div className="divide-y divide-slate-100">
          {companies.map(c => {
            const active = c.company_id === companyId;
            return (
              <div key={c.company_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-2">
                    <span className="truncate">{c.name}</span>
                    {c.is_default ? <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">DEFAULT</span> : null}
                    {active ? <Badge color="green">ACTIVE</Badge> : null}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{c.gstin ? `GSTIN ${c.gstin}` : 'No GSTIN'} · {c.state || 'No state'}</div>
                </div>
                <Button variant={active ? 'secondary' : 'primary'} onClick={() => switchCompany(c.company_id)} disabled={active}>
                  {active ? 'Active' : 'Select / Open'}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
              </div>
            );
          })}
        </div>
      </Card>

      {!current && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No company is active. Open a company above to start working.
        </p>
      )}

      {/* Add New Company modal */}
      {createOpen && (
        <Modal title="Add New Company" onClose={() => { setCreateOpen(false); resetCreateForm(); }} wide>
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

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={seedDemo} onChange={e => setSeedDemo(e.target.checked)} className="w-4 h-4 rounded text-indigo-600" />
              Seed with sample items, BOM & demo data
            </label>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button variant="primary" onClick={createCompany} disabled={creating}>{creating ? 'Creating...' : 'Create Company'}</Button>
          </div>
        </Modal>
      )}

      {/* Edit Company modal */}
      {editing && (
        <Modal title={`Edit Company — ${editing.name}`} onClose={() => setEditing(null)} wide
          footer={<Button onClick={() => setEditing(null)}>Close</Button>}>
          <CompanyProfileForm key={editing.company_id} company={editing} onSaved={() => setEditing(null)} />
        </Modal>
      )}

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
