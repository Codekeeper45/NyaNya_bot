import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('documents');

export interface ParsedDocument {
  text: string;
  filename: string;
  mimeType: string;
  pages?: number;
}

const SUPPORTED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/json': 'json',
  'text/html': 'html',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
};

const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'txt', 'csv', 'md', 'json', 'html', 'rtf',
]);

export function isSupportedDocument(mimeType: string, filename: string): boolean {
  if (SUPPORTED_TYPES[mimeType]) return true;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(ext);
}

export async function parseDocument(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const type = SUPPORTED_TYPES[mimeType] ?? ext;

  log.debug({ filename, mimeType, type, bytes: buffer.byteLength }, 'Parsing document');

  try {
    switch (type) {
      case 'pdf':
        return await parsePdf(buffer, filename, mimeType);
      case 'docx':
      case 'doc':
        return await parseDocx(buffer, filename, mimeType);
      case 'xlsx':
      case 'xls':
        return await parseXlsx(buffer, filename, mimeType);
      case 'pptx':
        return await parsePptx(buffer, filename, mimeType);
      case 'txt':
      case 'csv':
      case 'md':
      case 'html':
      case 'rtf':
        return { text: buffer.toString('utf-8').slice(0, 50000), filename, mimeType };
      case 'json':
        return { text: JSON.stringify(JSON.parse(buffer.toString('utf-8')), null, 2).slice(0, 50000), filename, mimeType };
      default:
        return { text: buffer.toString('utf-8').slice(0, 50000), filename, mimeType };
    }
  } catch (err) {
    log.error({ err, filename, type }, 'Document parse failed');
    throw err;
  }
}

async function parsePdf(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const pdfParseModule = await import('pdf-parse');
  const pdfParse = (pdfParseModule as unknown as { default: (buf: Buffer) => Promise<{ text: string; numpages: number }> }).default ?? pdfParseModule;
  const data = await pdfParse(buffer);
  return {
    text: data.text.slice(0, 50000),
    filename,
    mimeType,
    pages: data.numpages,
  };
}

async function parseDocx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value.slice(0, 50000), filename, mimeType };
}

async function parseXlsx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    lines.push(`=== Лист: ${sheetName} ===`);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    lines.push(csv);
  }
  return { text: lines.join('\n').slice(0, 50000), filename, mimeType };
}

async function parsePptx(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
  // Extract text from PPTX (ZIP-based) using xlsx which can read it partially
  // For basic text extraction, we read the XML inside the zip
  const { unzipSync } = await import('node:zlib');
  try {
    // Use xlsx to read pptx as slides
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (workbook.SheetNames.length > 0) {
      const lines = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        return sheet ? `=== ${name} ===\n${XLSX.utils.sheet_to_csv(sheet)}` : '';
      });
      return { text: lines.join('\n').slice(0, 50000), filename, mimeType };
    }
  } catch { /* fall through */ }
  return { text: `[Презентация: ${filename} — не удалось извлечь текст]`, filename, mimeType };
}
