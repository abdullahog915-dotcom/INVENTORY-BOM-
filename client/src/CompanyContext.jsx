import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setApiCompany } from './api.js';

const CompanyCtx = createContext(null);
export const useCompany = () => useContext(CompanyCtx);

export function CompanyProvider({ children }) {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [ready, setReady] = useState(false);
  const toast = null;

  useEffect(() => {
    const saved = Number(localStorage.getItem('craft_company_id')) || null;
    api('/companies').then((cs) => {
      setCompanies(cs);
      const valid = saved && cs.some(c => c.company_id === saved);
      const pick = valid ? saved : (cs.find(c => c.is_default)?.company_id || cs[0]?.company_id || null);
      setCompanyId(pick);
      setApiCompany(pick);
      if (pick) localStorage.setItem('craft_company_id', String(pick));
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const switchCompany = useCallback((id) => {
    setCompanyId(id);
    setApiCompany(id);
    localStorage.setItem('craft_company_id', String(id));
  }, []);

  const refreshCompanies = useCallback(async () => {
    const cs = await api('/companies');
    setCompanies(cs);
    return cs;
  }, []);

  const current = useMemo(() => companies.find(c => c.company_id === companyId) || null, [companies, companyId]);
  const value = useMemo(() => ({
    companies, companyId, current, ready, switchCompany, refreshCompanies,
    setCompanyId: switchCompany,
  }), [companies, companyId, current, ready, switchCompany, refreshCompanies]);

  return <CompanyCtx.Provider value={value}>{children}</CompanyCtx.Provider>;
}
