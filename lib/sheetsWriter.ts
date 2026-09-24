import { getAccessToken, spreadsheetId, gidFromUrl, colLetter, getSheetName, type ServiceAccount } from './sheetsAuth';

export async function writeSheetPublishResult(
  sheetUrl: string,
  rowIdx: number,
  publishedUrl: string,
): Promise<void> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) return;

  const sa: ServiceAccount = JSON.parse(saJson);
  const sid = spreadsheetId(sheetUrl);
  if (!sid) return;

  const token = await getAccessToken(sa);
  const authHeader = { Authorization: `Bearer ${token}` };

  const gid = gidFromUrl(sheetUrl);
  const sheetName = await getSheetName(sid, gid, token);

  // Read header row to find existing "Status" and "Published URL" columns
  const headerRange = `${sheetName}!1:1`;
  const headRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(headerRange)}`,
    { headers: authHeader },
  );
  const headJson = await headRes.json() as any;
  const headers: string[] = headJson.values?.[0] ?? [];

  const normalize = (s: string) => s.toLowerCase().trim().replace(/[\s_-]+/g, '');
  let statusCol = headers.findIndex((h) => normalize(h) === 'status');
  let urlCol = headers.findIndex((h) => {
    const n = normalize(h);
    return n.includes('shotlink') || n.includes('publishedurl') || n.includes('publishurl') || n.includes('shortlink') || n === 'link' || n === 'url';
  });

  // If not found, append new header columns
  if (statusCol < 0 || urlCol < 0) {
    const updates: any[] = [];
    if (statusCol < 0) {
      statusCol = headers.length;
      updates.push({
        range: `${sheetName}!${colLetter(statusCol + 1)}1`,
        values: [['Status']],
      });
    }
    if (urlCol < 0) {
      urlCol = statusCol < headers.length ? headers.length : statusCol + 1;
      updates.push({
        range: `${sheetName}!${colLetter(urlCol + 1)}1`,
        values: [['Published URL']],
      });
    }
    if (updates.length) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
        },
      );
    }
  }

  // Write status + published URL into the data row
  const sheetRow = rowIdx + 2; // row 1 = headers, rowIdx 0-based → row 2+
  const statusCell = `${sheetName}!${colLetter(statusCol + 1)}${sheetRow}`;
  const urlCell = `${sheetName}!${colLetter(urlCol + 1)}${sheetRow}`;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: statusCell, values: [['Done']] },
          { range: urlCell, values: [[publishedUrl]] },
        ],
      }),
    },
  );
}
