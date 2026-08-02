import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';

export const cx = (...args) => args.filter(Boolean).join(' ');

/* ---------------- Buttons ---------------- */
const BTN = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:bg-indigo-300',
  secondary: 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 shadow-sm disabled:opacity-50',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:bg-rose-300',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:bg-emerald-300',
  ghost: 'text-indigo-600 hover:bg-indigo-50 disabled:opacity-50',
};
export function Button({ variant = 'secondary', className, ...props }) {
  return (
    <button
      className={cx(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed',
        BTN[variant], className)}
      {...props}
    />
  );
}

/* ---------------- Form controls ---------------- */
export function Input({ label, hint, className, ...props }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>}
      <input
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export function Select({ label, hint, children, className, ...props }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>}
      <select
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      >
        {children}
      </select>
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

/* ---------------- Creatable select (combo-box) ----------------
   A select that also offers "+ Add New ..." which swaps to an inline input.
   onAdd(name) must create the value on the server and return the new value. */
export function CreatableSelect({ label, hint, options = [], value, onChange, onAdd, placeholder = 'Select...', addLabel = '+ Add New', className, inputPlaceholder = 'Type new value' }) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = newValue.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const created = await onAdd(v);
      onChange(created);
      setNewValue('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <label className={cx('block', className)}>
        {label && <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>}
        <div className="flex gap-1.5 items-center">
          <input
            autoFocus
            value={newValue}
            placeholder={inputPlaceholder}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <Button variant="primary" className="shrink-0" onClick={submit} disabled={busy || !newValue.trim()}>{busy ? 'Saving...' : 'Add'}</Button>
          <Button className="shrink-0" onClick={() => { setNewValue(''); setAdding(false); }}>Cancel</Button>
        </div>
      </label>
    );
  }

  return (
    <Select label={label} hint={hint} className={className} value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__add__') setAdding(true);
        else onChange(e.target.value);
      }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__add__">{addLabel}</option>
    </Select>
  );
}

/* ---------------- Card / Page header ---------------- */
export function Card({ title, subtitle, actions, children, className, pad = true }) {
  return (
    <div className={cx('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <div>
            {title && <h3 className="text-sm font-bold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {pad ? <div className="p-4">{children}</div> : children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'indigo' }) {
  const tones = {
    indigo: 'text-indigo-700',
    emerald: 'text-emerald-700',
    rose: 'text-rose-700',
    amber: 'text-amber-700',
    sky: 'text-sky-700',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('text-xl font-bold mt-1', tones[tone])}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Badge({ color = 'slate', children }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
  };
  return (
    <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border', colors[color])}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm">
      <span className="w-4 h-4 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
      {label}
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className={cx('bg-white rounded-xl shadow-xl w-full my-8', wide ? 'max-w-5xl' : 'max-w-2xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1 cursor-pointer">×</button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, onCancel, onConfirm, confirmText = 'Confirm', danger }) {
  return (
    <Modal title={title} onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmText}</Button>
        </>
      }>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

/** Dangerous confirmation requiring the user to type an exact word (e.g. "DELETE"). */
export function ConfirmText({ title, message, onCancel, onConfirm, confirmText = 'DELETE', placeholder, danger = true }) {
  const [val, setVal] = useState('');
  const enabled = val.trim() === confirmText;
  return (
    <Modal title={title} onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!enabled} onClick={onConfirm}>Proceed</Button>
        </>
      }>
      <p className="text-sm text-slate-600 mb-3">{message}</p>
      <Input placeholder={placeholder || `Type "${confirmText}" to confirm`} value={val}
        onChange={(e) => setVal(e.target.value)} autoFocus />
    </Modal>
  );
}

/* ---------------- Toast ---------------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => notify, [notify]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={cx(
            'px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white max-w-sm',
            t.type === 'error' ? 'bg-rose-600' : t.type === 'info' ? 'bg-sky-600' : 'bg-emerald-600')}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- misc constants ---------------- */
export const ITEM_TYPES = [
  { value: 'RAW_MATERIAL', label: 'Raw Material / कच्चा माल' },
  { value: 'SEMI_FINISHED', label: 'Semi-Finished / अर्ध-तैयार' },
  { value: 'FINISHED_GOOD', label: 'Finished Good / तैयार माल' },
  { value: 'SCRAP', label: 'Scrap / स्क्रैप' },
];
export const UNITS = ['kg', 'pcs', 'meter', 'sq.ft', 'liter', 'g', 'set', 'dozen'];
export const GST_SLABS = [0, 5, 12, 18, 28];

export function typeLabel(t) {
  const m = ITEM_TYPES.find(x => x.value === t);
  return m ? m.label : t;
}
