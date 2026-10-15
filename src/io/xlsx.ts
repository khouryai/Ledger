/**
 * The action log as an Excel workbook. SheetJS writes every cell from a JS string
 * as a string, so a title starting with "=" stays text and never becomes a formula.
 */
import * as XLSX from 'xlsx';
import { COLUMNS, type Row } from '../engine/table';

const WIDTHS: Record<string, number> = { No: 6, Raised: 11, Action: 48, Type: 11, With: 20, Company: 16, Due: 11, Status: 20, 'Next chase': 11, 'Last update': 40, Tags: 14, Notes: 30 };

export function actionLogWorkbook(rows: Row[], sheetName = 'Action log'): Uint8Array<ArrayBuffer> {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS as string[] });
  ws['!cols'] = COLUMNS.map((c) => ({ wch: WIDTHS[c] ?? 14 }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: COLUMNS.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Action log');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out) as Uint8Array<ArrayBuffer>;
}

/** Read a workbook back into rows, for the tests. */
export function readActionLog(bytes: Uint8Array): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}
