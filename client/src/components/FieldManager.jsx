import React, { useState } from 'react';
import { Button, Input, Select } from './ui.jsx';
import { ALL_FIELDS, FIELD_SECTIONS, CUSTOM_FIELD_TYPES } from '../fieldCatalog.js';

/**
 * FieldManager — collapsible panel to show/hide invoice fields (grouped by section)
 * and add user-defined custom fields.
 *
 * Props:
 *   visibleKeys  : Set<string> of currently visible field keys
 *   onToggle(key): toggle one field's visibility
 *   customFields : array of {key,label,type,value,section}
 *   onChange(fields): called when customFields array changes
 *   kind         : 'SALES' | 'PURCHASE' (controls which sections are relevant)
 */
export default function FieldManager({ visibleKeys, onToggle, customFields, onChange, kind = 'SALES' }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState({ label: '', type: 'text', section: 'meta' });

  const sections = FIELD_SECTIONS;

  const addCustom = () => {
    const label = newField.label.trim();
    if (!label) return;
    const key = `custom_${Date.now()}`;
    onChange([...customFields, { key, label, type: newField.type, value: '', section: newField.section }]);
    setNewField({ label: '', type: 'text', section: 'meta' });
    setAdding(false);
  };

  const updateCustom = (key, patch) => {
    onChange(customFields.map(f => f.key === key ? { ...f, ...patch } : f));
  };

  const removeCustom = (key) => {
    onChange(customFields.filter(f => f.key !== key));
  };

  const countVisible = visibleKeys ? visibleKeys.size : 0;
  const totalFields = ALL_FIELDS.length + customFields.length;

  return (
    <div className="border border-slate-200 rounded-lg bg-white mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-t-lg cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className="text-base">⚙️</span> Fields ({countVisible}/{totalFields})
        </span>
        <span className="text-slate-400 text-xs">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-slate-100">
          {/* Custom field adder */}
          <div className="mt-2 bg-indigo-50/50 rounded-lg p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 mb-1.5">Add Custom Field</div>
            {!adding ? (
              <Button size="xs" variant="secondary" onClick={() => setAdding(true)}>+ Add Custom Field</Button>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                <Input label="Label" value={newField.label} placeholder="e.g. Department Code"
                  onChange={e => setNewField(f => ({ ...f, label: e.target.value }))} autoFocus />
                <Select label="Type" value={newField.type} onChange={e => setNewField(f => ({ ...f, type: e.target.value }))}>
                  {CUSTOM_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <Select label="Section" value={newField.section} onChange={e => setNewField(f => ({ ...f, section: e.target.value }))}>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
                <div className="flex gap-1.5">
                  <Button variant="primary" size="xs" onClick={addCustom} disabled={!newField.label.trim()}>Add</Button>
                  <Button size="xs" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Sections with toggle checkboxes */}
          <div className="mt-3 space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {sections.map(section => {
              const fields = [...ALL_FIELDS.filter(f => f.section === section.id),
                ...customFields.filter(f => f.section === section.id)];
              if (fields.length === 0) return null;
              const visibleInSection = fields.filter(f => visibleKeys && visibleKeys.has(f.key)).length;
              return (
                <div key={section.id} className="border border-slate-100 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      {section.icon} {section.label}
                    </span>
                    <span className="text-[10px] text-slate-400">{visibleInSection}/{fields.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1">
                    {fields.map(f => (
                      <FieldToggle key={f.key} field={f} visible={visibleKeys?.has(f.key) || false}
                        onToggle={onToggle} onUpdateCustom={updateCustom} onRemoveCustom={removeCustom}
                        customValue={customFields.find(c => c.key === f.key)?.value} kind={kind} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* Single checkbox toggle (with inline custom-field editor when applicable) */
function FieldToggle({ field, visible, onToggle, onUpdateCustom, onRemoveCustom, customValue, kind }) {
  const isCustom = field.key.startsWith('custom_');

  return (
    <div className={`flex items-start justify-between gap-1.5 rounded px-1 py-0.5 ${visible ? '' : 'opacity-80'}`}>
      <label className="flex items-start gap-1.5 cursor-pointer flex-1 text-[11px] text-slate-600 leading-tight">
        <input
          type="checkbox"
          checked={visible}
          onChange={() => onToggle(field.key)}
          className="mt-0.5 w-3.5 h-3.5 rounded text-indigo-600"
        />
        <span>{field.label}</span>
      </label>
      {isCustom && visible && (
        <div className="flex items-center gap-1">
          <button type="button" className="text-rose-500 hover:text-rose-700 text-sm cursor-pointer leading-none"
            onClick={() => onToggle(field.key)} title="Hide">×</button>
          <button type="button" className="text-slate-400 hover:text-rose-600 text-sm cursor-pointer leading-none"
            onClick={() => onRemoveCustom(field.key)} title="Delete custom field (also hides)">🗑</button>
        </div>
      )}
      {isCustom && visible && (
        <div className="col-span-1 sm:col-span-2 lg:col-span-3 mt-1">
          <CustomValueInput field={field} value={customValue} onChange={v => onUpdateCustom(field.key, { value: v })} />
        </div>
      )}
    </div>
  );
}

function CustomValueInput({ field, value, onChange }) {
  if (field.type === 'textarea') {
    return <textarea rows={2} value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />;
  }
  if (field.type === 'number') {
    return <input type="number" step="any" value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />;
  }
  if (field.type === 'date') {
    return <input type="date" value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />;
  }
  return <input type="text" value={value || ''} placeholder="Value" onChange={e => onChange(e.target.value)}
    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />;
}