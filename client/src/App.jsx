import React, { useState } from 'react';
import { ToastProvider, Select } from './components/ui.jsx';
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

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { section: 'Masters' },
  { id: 'items', label: 'Item Master' },
  { id: 'customers', label: 'Customers' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'bom', label: 'BOM (Bill of Materials)' },
  { section: 'Transactions' },
  { id: 'production', label: 'Production' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'sales', label: 'Sales' },
  { id: 'jobwork', label: 'Job Work' },
  { id: 'adjustments', label: 'Adjustments / Scrap' },
  { section: 'Reports' },
  { id: 'reports', label: 'Reports' },
  { id: 'ledger', label: 'Stock Ledger' },
  { section: 'System' },
  { id: 'settings', label: 'Settings' },
];

function Shell() {
  const { companyId, companies, current, switchCompany, ready } = useCompany();
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (id) => { setPage(id); setMenuOpen(false); };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 bg-slate-900 text-slate-200 flex flex-col transform transition-transform lg:static lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 py-4 border-b border-slate-700/60 cursor-pointer hover:bg-slate-800/60 transition-colors" onClick={() => go('dashboard')} title="Go to Dashboard">
          <div className="font-bold text-white text-sm leading-tight flex items-center justify-between">
            <span>Craft ERP</span>
            <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded font-mono">v1.0</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Inventory + BOM</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {NAV.map((item, i) =>
            item.section ? (
              <div key={i} className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{item.section}</div>
            ) : (
              <button
                key={i}
                onClick={() => go(item.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                  page === item.id ? 'bg-indigo-600 text-white font-semibold shadow-sm' : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div>{item.label}</div>
              </button>
            )
          )}
        </nav>
        <div className="px-4 py-3 text-[10px] text-slate-500 border-t border-slate-700/60">
          Data stored locally in <span className="font-mono">data/craft-erp.db</span>
        </div>
      </aside>

      {menuOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
          <button className="text-slate-600 text-xl cursor-pointer lg:hidden" onClick={() => setMenuOpen(true)}>☰</button>
          <div className="min-w-0 flex-1 cursor-pointer group" onClick={() => setPage('dashboard')} title="Click to open Dashboard">
            <div className="font-bold text-sm truncate text-slate-800 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
              <span>{current?.name || 'Craft ERP'}</span>
              <span className="text-[10px] text-indigo-600 font-normal bg-indigo-50 px-1.5 py-0.2 rounded group-hover:bg-indigo-100">Dashboard</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">{current?.gstin ? `GSTIN ${current.gstin}` : (current?.state || '')}</div>
          </div>
          {ready && companies.length > 0 && (
            <Select className="w-56" value={companyId || ''}
              onChange={(e) => { if (e.target.value) switchCompany(Number(e.target.value)); }}>
              {companies.map(c => <option key={c.company_id} value={c.company_id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
            </Select>
          )}
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          {page === 'dashboard' && <Dashboard key={companyId} go={go} />}
          {page === 'items' && <Items key={companyId} />}
          {page === 'customers' && <Customers key={companyId} />}
          {page === 'vendors' && <Vendors key={companyId} />}
          {page === 'bom' && <BOM key={companyId} />}
          {page === 'production' && <Production key={companyId} />}
          {page === 'purchase' && <Purchase key={companyId} />}
          {page === 'sales' && <Sales key={companyId} />}
          {page === 'jobwork' && <JobWork key={companyId} />}
          {page === 'adjustments' && <Adjustments key={companyId} />}
          {page === 'ledger' && <Ledger key={companyId} />}
          {page === 'reports' && <Reports key={companyId} />}
          {page === 'settings' && <Settings key={companyId} />}
        </main>
      </div>
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
