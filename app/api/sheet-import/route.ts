import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// --- CSV parser (handles quoted fields, commas inside quotes, CRLF) ---
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
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
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

// --- Column header matching (case-insensitive, flexible) ---
const COLUMN_ALIASES: Record<string, string[]> = {
  courseTitle:       ['course title', 'course name', 'course'],
  courseSummary:     ['course summary', 'course description'],
  domain:            ['domain', 'vertical', 'track', 'category'],
  chapterTitle:      ['chapter title', 'chapter name', 'chapter'],
  chapterSummary:    ['chapter summary', 'chapter description'],
  lessonTitle:       ['lesson title', 'lesson name', 'lesson', 'title'],
  outline:           ['outline', 'lesson outline', 'description', 'lesson description', 'summary'],
  templateLessonUrl: ['template lesson url', 'template url', 'template lesson', 'template', 'template lesson link', 'lesson template url', 'lesson template'],
  targetAudience:    ['audience', 'target audience', 'level', 'difficulty'],
  wordsLength:       ['word count', 'words', 'word length', 'length', 'words count'],
  runJsEnabled:      ['runjs', 'run js', 'interactive', 'playground', 'run javascript'],
  aiAssessmentEnabled: ['ai assessment', 'assessment', 'ai', 'prompt ai'],
  prevLessonTitle:   ['prev lesson', 'previous lesson', 'prev lesson title', 'previous lesson title', 'prev', 'previous'],
  nextLessonTitle:   ['next lesson', 'next lesson title', 'next'],
};

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let col = 0; col < headers.length; col++) {
      const h = headers[col].toLowerCase().trim();
      if (aliases.includes(h)) {
        map[field] = col;
        break;
      }
    }
  }
  return map;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0) return '';
  return (row[idx] || '').trim();
}

function parseBool(v: string): boolean {
  return /^(true|yes|1|y|on)$/i.test(v.trim());
}

function parseNum(v: string, def: number): number {
  const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? def : n;
}

// --- Google Sheets URL → CSV export URL ---
function toCsvExportUrl(rawUrl: string): string {
  rawUrl = rawUrl.trim();

  // Already a CSV export or publish URL — return as-is
  if (rawUrl.includes('/export?format=csv') || rawUrl.includes('/pub?output=csv')) {
    return rawUrl;
  }

  // Extract spreadsheet ID
  const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new Error('Could not extract spreadsheet ID from URL. Make sure it is a valid Google Sheets URL.');
  const sheetId = idMatch[1];

  // Extract gid (tab/sheet ID) from query param or hash
  const gidMatch = rawUrl.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

// --- Main handler ---
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url?.trim()) return Response.json({ error: 'No URL provided' }, { status: 400 });

    let csvUrl: string;
    try {
      csvUrl = toCsvExportUrl(url);
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    // Fetch the CSV (the sheet must be shared "Anyone with the link can view")
    const res = await fetch(csvUrl, {
      headers: { 'Accept': 'text/csv, text/plain, */*' },
      redirect: 'follow',
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return Response.json({
          error: 'The Google Sheet is not publicly accessible. Share it with "Anyone with the link" set to Viewer, then try again.',
        }, { status: 403 });
      }
      return Response.json({ error: `Failed to fetch sheet: HTTP ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || '';
    // If Google redirected to a login page (HTML), the content-type will be text/html
    if (contentType.includes('text/html')) {
      return Response.json({
        error: 'Google returned a login page instead of CSV data. Make sure the sheet is shared with "Anyone with the link" → Viewer access.',
      }, { status: 403 });
    }

    const rawCsv = await res.text();
    if (!rawCsv.trim()) return Response.json({ error: 'The sheet appears to be empty.' }, { status: 400 });

    const rows = parseCsv(rawCsv);
    if (rows.length < 2) return Response.json({ error: 'Sheet has no data rows (only a header row was found).' }, { status: 400 });

    const headers = rows[0];
    const colMap = buildHeaderMap(headers);
    const dataRows = rows.slice(1);

    // Pull course-level fields from first row with data
    const firstRow = dataRows[0];
    const courseTitle = cell(firstRow, colMap.courseTitle);
    const courseSummary = cell(firstRow, colMap.courseSummary);
    const domain = cell(firstRow, colMap.domain) || 'System Design';

    // Group rows into chapters → lessons
    const chapterMap = new Map<string, {
      chapterTitle: string;
      chapterSummary: string;
      lessons: any[];
    }>();
    const chapterOrder: string[] = [];

    for (const row of dataRows) {
      const lessonTitle = cell(row, colMap.lessonTitle);
      if (!lessonTitle) continue; // skip rows without a lesson title

      const chapterTitle = cell(row, colMap.chapterTitle) || 'Chapter 1';
      const chapterKey = chapterTitle.toLowerCase().trim();

      if (!chapterMap.has(chapterKey)) {
        chapterMap.set(chapterKey, {
          chapterTitle,
          chapterSummary: cell(row, colMap.chapterSummary),
          lessons: [],
        });
        chapterOrder.push(chapterKey);
      }

      const chapter = chapterMap.get(chapterKey)!;
      // Update chapterSummary if not yet set
      if (!chapter.chapterSummary) chapter.chapterSummary = cell(row, colMap.chapterSummary);

      const rawWords = cell(row, colMap.wordsLength);
      const rawRunJs = cell(row, colMap.runJsEnabled);
      const rawAi = cell(row, colMap.aiAssessmentEnabled);

      chapter.lessons.push({
        lessonTitle,
        outline: cell(row, colMap.outline),
        templateLessonUrl: cell(row, colMap.templateLessonUrl),
        targetAudience: cell(row, colMap.targetAudience) || 'Intermediate',
        wordsLength: parseNum(rawWords, 2000),
        runJsEnabled: rawRunJs ? parseBool(rawRunJs) : false,
        aiAssessmentEnabled: rawAi ? parseBool(rawAi) : true,
        prevLessonTitle: cell(row, colMap.prevLessonTitle),
        nextLessonTitle: cell(row, colMap.nextLessonTitle),
      });
    }

    if (chapterMap.size === 0) {
      return Response.json({ error: 'No lessons found. Make sure the sheet has a "Lesson Title" column with data.' }, { status: 400 });
    }

    const chapters = chapterOrder.map((key) => chapterMap.get(key)!);

    return Response.json({
      courseTitle,
      courseSummary,
      domain,
      chapters,
      rowCount: dataRows.length,
      lessonCount: chapters.reduce((s, c) => s + c.lessons.length, 0),
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
