import React from 'react';
import { downloadCSV } from '../utils.js';
import { Button } from './ui.jsx';

export default function ExportCSV({ filename, columns, rows, label = 'Export Excel/CSV' }) {
  return (
    <Button
      variant="secondary"
      onClick={() => downloadCSV(filename, columns, rows)}
      disabled={!rows || rows.length === 0}
      title="Download as CSV (opens in Excel)"
    >
      {label}
    </Button>
  );
}
