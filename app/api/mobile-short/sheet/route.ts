import { NextRequest } from 'next/server';
import { getAccessToken, spreadsheetId, gidFromUrl, getSheetName, type ServiceAccount } from '@/lib/sheetsAuth';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function readViaApi(url: string): Promise<{ headers: string[]; rows: string[][]; rowIndices: number[]; rowCount: number }> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error('NO_SA');

  const sa: ServiceAccount = JSON.parse(saJson);
  const sid = spreadsheetId(url);
  if (!sid) throw new Error('Could not extract spreadsheet ID from URL.');

  const token = await getAccessToken(sa);
  const gid = gidFromUrl(url);
  const sheetName = await getSheetName(sid, gid, token);

  const range = encodeURIComponent(sheetName);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    if (res.status === 403) throw new Error(`Service account does not have access to this sheet. Share it with your service account email and try again.`);
    throw new Error(`Sheets API error: HTTP ${res.status}`);
  }

  const json = await res.json() as any;
  const allRows: string[][] = (json.values ?? []).map((r: any[]) => r.map((c) => String(c ?? '').trim()));
  if (allRows.length < 2) throw new Error('Sheet has no data rows.');

  const headerRowIdx = allRows.findIndex((r) => r.filter((c) => c !== '').length >= 3);
  if (headerRowIdx < 0) throw new Error('Could not find a header row in the sheet.');

  const headers = allRows[headerRowIdx];
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const statusColIdx = headers.findIndex((h) => normalize(h) === 'status' || normalize(h).includes('status'));

  // Tag each data row with its 0-based position AFTER the header (= rowIdx sheetsWriter uses with rowIdx+2).
  // Do NOT skip empty rows before assigning the index — gaps in the sheet must be preserved.
  const tagged = allRows
    .slice(headerRowIdx + 1)
    .map((cells, i) => ({ cells, idx: i }))
    .filter(({ cells }) => cells.some((c) => c !== ''));

  const filtered = statusColIdx >= 0
    ? tagged.filter(({ cells }) => cells[statusColIdx]?.trim().toLowerCase() === 'in progress')
    : tagged;

  const rows = filtered.map(({ cells }) => cells);
  const rowIndices = filtered.map(({ idx }) => idx);
  return { headers, rows, rowIndices, rowCount: rows.length };
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim()); field = '';
      } else if (ch === '\n') {
        row.push(field.trim()); field = '';
        if (row.some((c) => c !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function toCsvExportUrl(rawUrl: string): string {
  rawUrl = rawUrl.trim();
  if (rawUrl.includes('/export?format=csv') || rawUrl.includes('/pub?output=csv')) return rawUrl;
  const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new Error('Could not extract spreadsheet ID. Make sure it is a valid Google Sheets URL.');
  const sheetId = idMatch[1];
  const gidMatch = rawUrl.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

async function readViaCsv(url: string): Promise<{ headers: string[]; rows: string[][]; rowIndices: number[]; rowCount: number }> {
  const csvUrl = toCsvExportUrl(url);
  const res = await fetch(csvUrl, { headers: { Accept: 'text/csv, text/plain, */*' }, redirect: 'follow' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error('Sheet is not publicly accessible. Either configure a service account (GOOGLE_SERVICE_ACCOUNT_JSON) and share the sheet with it, or share the sheet with "Anyone with the link" → Viewer.');
    throw new Error(`Failed to fetch sheet: HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html'))
    throw new Error('Google returned a login page. The sheet has restricted access. Configure a service account (GOOGLE_SERVICE_ACCOUNT_JSON) and share the sheet with it.');

  const raw = await res.text();
  if (!raw.trim()) throw new Error('Sheet is empty.');

  const allRows = parseCsv(raw);
  if (allRows.length < 2) throw new Error('Sheet has no data rows.');

  const headerRowIdx = allRows.findIndex((r) => r.filter((c) => c !== '').length >= 3);
  if (headerRowIdx < 0) throw new Error('Could not find a header row in the sheet.');
  const headers = allRows[headerRowIdx];
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const statusColIdx = headers.findIndex((h) => normalize(h) === 'status' || normalize(h).includes('status'));

  const tagged = allRows
    .slice(headerRowIdx + 1)
    .map((cells, i) => ({ cells, idx: i }))
    .filter(({ cells }) => cells.some((c) => c !== ''));

  const filtered = statusColIdx >= 0
    ? tagged.filter(({ cells }) => cells[statusColIdx]?.trim().toLowerCase() === 'in progress')
    : tagged;

  const rows = filtered.map(({ cells }) => cells);
  const rowIndices = filtered.map(({ idx }) => idx);
  return { headers, rows, rowIndices, rowCount: rows.length };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url?.trim()) return Response.json({ error: 'No URL provided' }, { status: 400 });

    // Try service account API first, fall back to public CSV
    try {
      const result = await readViaApi(url.trim());
      return Response.json(result);
    } catch (apiErr: any) {
      if (apiErr.message !== 'NO_SA') {
        // SA is configured but failed — surface the real error
        return Response.json({ error: apiErr.message }, { status: 403 });
      }
      // No SA configured — try public CSV
    }

    try {
      const result = await readViaCsv(url.trim());
      return Response.json(result);
    } catch (csvErr: any) {
      return Response.json({ error: csvErr.message }, { status: 403 });
    }
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
