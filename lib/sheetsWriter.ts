import { getAccessToken, spreadsheetId, gidFromUrl, colLetter, getSheetName, type ServiceAccount } from './sheetsAuth';

export async function writeSheetPublishResult(
  sheetUrl: string,
  rowIdx: number,
  publishedUrl: string,
): Promise<void> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');

  const sa: ServiceAccount = JSON.parse(saJson);
  const sid = spreadsheetId(sheetUrl);
  if (!sid) throw new Error(`Could not extract spreadsheet ID from: ${sheetUrl}`);

  const token = await getAccessToken(sa);
  const auth = { Authorization: `Bearer ${token}` };

  const gid = gidFromUrl(sheetUrl);
  const sheetName = await getSheetName(sid, gid, token);

  // Read the first row to locate "Status" and "Shot link" columns
  const headRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`${sheetName}!1:1`)}`,
    { headers: auth },
  );
  if (!headRes.ok) throw new Error(`Sheets read headers failed: ${headRes.status} ${await headRes.text()}`);
  const headers: string[] = ((await headRes.json() as any).values?.[0] ?? []);

  console.log('[sheetsWriter] headers:', headers);

  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, '');
  const statusCol = headers.findIndex((h) => norm(h) === 'status');
  const urlCol = headers.findIndex((h) => {
    const n = norm(h);
    return n === 'shotlink' || n === 'shortlink' || n === 'link' || n === 'url' || n.includes('shotlink') || n.includes('publishedurl');
  });

  console.log(`[sheetsWriter] statusCol=${statusCol} urlCol=${urlCol} rowIdx=${rowIdx} sheetRow=${rowIdx + 2}`);

  if (statusCol < 0) throw new Error(`"Status" column not found in sheet. Headers: ${headers.join(', ')}`);
  if (urlCol < 0) throw new Error(`"Shot link" column not found in sheet. Headers: ${headers.join(', ')}`);

  const sheetRow = rowIdx + 2; // row 1 = header, data rows are 0-based after header
  const data = [
    { range: `${sheetName}!${colLetter(statusCol + 1)}${sheetRow}`, values: [['Done']] },
    { range: `${sheetName}!${colLetter(urlCol + 1)}${sheetRow}`, values: [[publishedUrl]] },
  ];

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    },
  );
  if (!writeRes.ok) throw new Error(`Sheets write failed: ${writeRes.status} ${await writeRes.text()}`);
  console.log(`[sheetsWriter] wrote Done + URL to row ${sheetRow}`);
}
