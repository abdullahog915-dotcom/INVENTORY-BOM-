import React, { useState, useEffect, useRef } from 'react';
import { ToastProvider, Select, cx } from './components/ui.jsx';
import { CompanyProvider, useCompany } from './CompanyContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Items from './pages/Items.jsx';
import Customers from './pages/Customers.jsx';
import Vendors from './pages/Vendors.jsx';
import BOM from './pages/BOM.jsx';
import Production from './pages/Production.jsx';
import Purchase from './pages/Purchase.jsx';
import Sales from './pages/Sales.jsx';
import JobWork from './pages/JobWork.jsx';
import Adjustments from './pages/Adjustments.jsx';
import Ledger from './pages/Ledger.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Companies from './pages/Companies.jsx';

const CATEGORIES = [
  {
    id: 'masters',
    label: 'Masters',
    items: [
      { id: 'items', label: 'Item Master' },
      { id: 'customers', label: 'Customers' },
      { id: 'vendors', label: 'Vendors' },
      { id: 'bom', label: 'BOM (Bill of Materials)' },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    items: [
      { id: 'production', label: 'Production' },
      { id: 'purchase', label: 'Purchase' },
      { id: 'sales', label: 'Sales' },
      { id: 'jobwork', label: 'Job Work' },
      { id: 'adjustments', label: 'Adjustments / Scrap' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { id: 'reports', label: 'Reports' },
      { id: 'ledger', label: 'Stock Ledger' },
    ],
  },
];

const STANDALONE = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
  { id: 'companies', label: 'Companies' },
];

const CREATE = [
  { page: 'items', label: 'New Item' },
  { page: 'customers', label: 'New Customer' },
  { page: 'vendors', label: 'New Vendor' },
  { page: 'bom', label: 'New BOM' },
  { page: 'production', label: 'New Production Order' },
  { page: 'purchase', label: 'New Purchase (Order/Entry)' },
  { page: 'sales', label: 'New Sales Invoice' },
  { page: 'jobwork', label: 'New Job Work' },
  { page: 'companies', label: 'New Company' },
];

function CreateDropdown({ page, go, open, setOpen }) {
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(open === 'create' ? null : 'create'); }}
        className={cx(
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-1',
          open === 'create'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50'
        )}
        title="Quick-create a new record"
      >
        + Create
        <span className={cx('text-[10px]', open === 'create' ? 'rotate-180' : '')}>▾</span>
      </button>
      {open === 'create' && (
        <div className="absolute left-0 top-full mt-1 w-72 rounded-lg bg-white border border-slate-200 shadow-xl py-1 z-50">
          {CREATE.map(item => (
            <button
              key={item.page}
              onClick={() => { go(item.page, { create: true }); setOpen(null); }}
              className={cx(
                'w-full text-left px-3 py-2 text-sm rounded-md cursor-pointer transition-colors',
                page === item.page ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopNav({ page, go }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const activeCat = CATEGORIES.find(c => c.items.some(i => i.id === page))?.id || null;

  const linkCls = (active) => cx(
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-1',
    active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  );

  const renderItem = (item) => (
    <button key={item.id} onClick={() => { go(item.id); setOpen(null); }} className={linkCls(page === item.id)}>
      {item.label}
    </button>
  );

  const renderCategory = (cat) => {
    const catActive = activeCat === cat.id;
    const openThis = open === cat.id;
    return (
      <div key={cat.id} className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(openThis ? null : cat.id); }}
          className={linkCls(catActive || openThis)}
        >
          {cat.label}
          <span className={cx('text-[10px]', openThis ? 'rotate-180' : '')}>▾</span>
        </button>
        {openThis && (
          <div className="absolute left-0 top-full mt-1 w-64 rounded-lg bg-white border border-slate-200 shadow-xl py-1 z-50">
            {cat.items.map(item => (
              <button
                key={item.id}
                onClick={() => { go(item.id); setOpen(null); }}
                className={cx(
                  'w-full text-left px-3 py-2 text-sm rounded-md cursor-pointer transition-colors',
                  page === item.id ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav ref={ref} className="flex items-center gap-1 flex-wrap">
      {renderItem(STANDALONE[0])}
      <CreateDropdown page={page} go={go} open={open} setOpen={setOpen} />
      {CATEGORIES.map(renderCategory)}
      {STANDALONE.slice(1).map(renderItem)}
    </nav>
  );
}

function MobileMenu({ page, go, menuOpen, onClose }) {
  if (!menuOpen) return null;
  const itemCls = (active) => cx(
    'w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer',
    active ? 'bg-indigo-600 text-white font-semibold shadow-sm' : 'hover:bg-slate-100 text-slate-700'
  );
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="fixed inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-xl flex flex-col overflow-y-auto z-10">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="font-bold text-slate-800 text-sm">Craft ERP</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1 cursor-pointer">×</button>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          <button onClick={() => go('dashboard')} className={itemCls(page === 'dashboard')}>Dashboard</button>

          <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Create</div>
          {CREATE.map(item => (
            <button key={item.page} onClick={() => go(item.page, { create: true })} className={itemCls(page === item.page)}>
              {item.label}
            </button>
          ))}

          {CATEGORIES.map(cat => (
            <div key={cat.id}>
              <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{cat.label}</div>
              {cat.items.map(item => (
                <button key={item.id} onClick={() => go(item.id)} className={itemCls(page === item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          <button onClick={() => go('settings')} className={itemCls(page === 'settings')}>Settings</button>
          <button onClick={() => go('companies')} className={itemCls(page === 'companies')}>Companies</button>
        </nav>
      </div>
    </div>
  );
}

function Shell() {
  const { companyId, companies, current, switchCompany, ready } = useCompany();
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [createReq, setCreateReq] = useState(null);

  const go = (id, opts) => {
    setPage(id);
    setMenuOpen(false);
    setCreateReq(opts?.create ? { page: id, ts: Date.now() } : null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <button className="text-slate-600 text-xl cursor-pointer lg:hidden" onClick={() => setMenuOpen(true)} title="Open menu">☰</button>
          <div className="min-w-0 flex-1 cursor-pointer group" onClick={() => setPage('dashboard')} title="Click to open Dashboard">
            <div className="font-bold text-sm truncate text-slate-800 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
              <span>{current?.name || 'Craft ERP'}</span>
              <span className="text-[10px] text-indigo-600 font-normal bg-indigo-50 px-1.5 py-0.2 rounded group-hover:bg-indigo-100">Dashboard</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">{current?.gstin ? `GSTIN ${current.gstin}` : (current?.state || '')}</div>
          </div>
          {ready && companies.length > 0 && (
            <Select className="w-56" value={companyId || ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__manage__') { go('companies'); return; }
                if (v) switchCompany(Number(v));
              }}>
              {companies.map(c => <option key={c.company_id} value={c.company_id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
              <option value="__manage__">Manage Companies...</option>
            </Select>
          )}
        </div>
        <div className="hidden lg:block px-3 pb-1.5 border-t border-slate-100">
          <TopNav page={page} go={go} />
        </div>
      </header>

      <MobileMenu page={page} go={go} menuOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
        {page === 'dashboard' && <Dashboard key={companyId} go={go} />}
        {page === 'items' && <Items key={companyId} createReq={createReq} />}
        {page === 'customers' && <Customers key={companyId} createReq={createReq} />}
        {page === 'vendors' && <Vendors key={companyId} createReq={createReq} />}
        {page === 'bom' && <BOM key={companyId} createReq={createReq} />}
        {page === 'production' && <Production key={companyId} createReq={createReq} />}
        {page === 'purchase' && <Purchase key={companyId} createReq={createReq} />}
        {page === 'sales' && <Sales key={companyId} createReq={createReq} />}
        {page === 'jobwork' && <JobWork key={companyId} createReq={createReq} />}
        {page === 'adjustments' && <Adjustments key={companyId} />}
        {page === 'ledger' && <Ledger key={companyId} />}
        {page === 'reports' && <Reports key={companyId} />}
        {page === 'settings' && <Settings key={companyId} />}
        {page === 'companies' && <Companies key={companyId} createReq={createReq} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <CompanyProvider>
        <Shell />
      </CompanyProvider>
    </ToastProvider>
  );
}
