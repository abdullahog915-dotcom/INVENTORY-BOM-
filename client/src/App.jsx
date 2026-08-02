import React, { useState } from 'react';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Items from './pages/Items.jsx';
import Vendors from './pages/Vendors.jsx';
import BOM from './pages/BOM.jsx';
import Production from './pages/Production.jsx';
import Purchase from './pages/Purchase.jsx';
import Sales from './pages/Sales.jsx';
import JobWork from './pages/JobWork.jsx';
import Adjustments from './pages/Adjustments.jsx';
import Ledger from './pages/Ledger.jsx';
import Reports from './pages/Reports.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', hi: 'डैशबोर्ड' },
  { section: 'Masters / मास्टर' },
  { id: 'items', label: 'Item Master', hi: 'आइटम मास्टर' },
  { id: 'vendors', label: 'Vendors', hi: 'विक्रेता' },
  { id: 'bom', label: 'BOM (Bill of Materials)', hi: 'बीओएम' },
  { section: 'Transactions / लेन-देन' },
  { id: 'production', label: 'Production', hi: 'उत्पादन' },
  { id: 'purchase', label: 'Purchase', hi: 'खरीद' },
  { id: 'sales', label: 'Sales', hi: 'बिक्री' },
  { id: 'jobwork', label: 'Job Work', hi: 'जॉब वर्क' },
  { id: 'adjustments', label: 'Adjustments / Scrap', hi: 'समायोजन' },
  { section: 'Reports / रिपोर्ट' },
  { id: 'reports', label: 'Reports', hi: 'रिपोर्ट' },
  { id: 'ledger', label: 'Stock Ledger', hi: 'स्टॉक लेज़र' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (id) => { setPage(id); setMenuOpen(false); };

  return (
    <ToastProvider>
      <div className="min-h-screen flex">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-60 bg-slate-900 text-slate-200 flex flex-col transform transition-transform lg:static lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="px-4 py-4 border-b border-slate-700/60">
            <div className="font-bold text-white text-sm leading-tight">Craft ERP</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Inventory + BOM / इन्वेंट्री</div>
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
                    page === item.id ? 'bg-indigo-600 text-white font-semibold' : 'hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div>{item.label}</div>
                  <div className={`text-[10px] ${page === item.id ? 'text-indigo-200' : 'text-slate-500'}`}>{item.hi}</div>
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
          <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 lg:hidden">
            <button className="text-slate-600 text-xl cursor-pointer" onClick={() => setMenuOpen(true)}>☰</button>
            <span className="font-bold text-sm">Craft ERP</span>
          </header>
          <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
            {page === 'dashboard' && <Dashboard go={go} />}
            {page === 'items' && <Items />}
            {page === 'vendors' && <Vendors />}
            {page === 'bom' && <BOM />}
            {page === 'production' && <Production />}
            {page === 'purchase' && <Purchase />}
            {page === 'sales' && <Sales />}
            {page === 'jobwork' && <JobWork />}
            {page === 'adjustments' && <Adjustments />}
            {page === 'ledger' && <Ledger />}
            {page === 'reports' && <Reports />}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
