import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

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

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url?.trim()) return Response.json({ error: 'No URL provided' }, { status: 400 });

    let csvUrl: string;
    try { csvUrl = toCsvExportUrl(url); }
    catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }

    const res = await fetch(csvUrl, { headers: { Accept: 'text/csv, text/plain, */*' }, redirect: 'follow' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        return Response.json({ error: 'Sheet is not publicly accessible. Share it with "Anyone with the link" → Viewer.' }, { status: 403 });
      return Response.json({ error: `Failed to fetch sheet: HTTP ${res.status}` }, { status: 502 });
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html'))
      return Response.json({ error: 'Google returned a login page. Share the sheet publicly first.' }, { status: 403 });

    const raw = await res.text();
    if (!raw.trim()) return Response.json({ error: 'Sheet is empty.' }, { status: 400 });

    const allRows = parseCsv(raw);
    if (allRows.length < 2) return Response.json({ error: 'Sheet has no data rows.' }, { status: 400 });

    const headers = allRows[0];
    const rows = allRows.slice(1).filter((r) => r.some((c) => c !== ''));

    return Response.json({ headers, rows, rowCount: rows.length });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
