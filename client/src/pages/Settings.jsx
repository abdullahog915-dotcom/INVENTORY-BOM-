import React from 'react';
import { PageHeader, Card, Spinner } from '../components/ui.jsx';
import { useCompany } from '../CompanyContext.jsx';
import CompanyProfileForm from '../components/CompanyProfileForm.jsx';

export default function Settings() {
  const { current, companyId } = useCompany();

  if (!current) return <Spinner label="Loading..." />;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, bank details, invoice terms & field defaults" />

      {/* Current Company Profile */}
      <Card title="Current Company Profile">
        <CompanyProfileForm key={companyId} company={current} />
      </Card>
    </div>
  );
}
