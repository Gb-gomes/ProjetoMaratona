/**
 * Leitura de planilhas no navegador: CSV (e TXT/TSV) e Excel (.xlsx/.xlsm).
 *
 * Como não sabemos em que formato o arquivo da engenharia vai chegar:
 *  - Excel: lê todas as abas; a aba padrão é a que parece ter os pontos
 *    (mais colunas reconhecidas: latitude, longitude, CAR, fazenda…);
 *  - a linha de cabeçalho não precisa ser a primeira: títulos e linhas em
 *    branco acima da tabela são ignorados;
 *  - .xls (Excel 97-2003) e .ods não são lidos: a mensagem pede para salvar
 *    como .xlsx ou .csv.
 *
 * Nada é enviado: o arquivo é aberto com FileReader e descompactado em memória
 * (fflate). O .xlsx é um ZIP de XMLs; aqui só se leem os valores das células.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { parseCsv, decodeBuffer, suggestMapping } from './csv.js';

export const ACCEPTED_EXTENSIONS = '.csv,.txt,.tsv,.xlsx,.xlsm';
export const ACCEPT_ATTR = `${ACCEPTED_EXTENSIONS},text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;

const ext = (name) => (/\.([a-z0-9]+)$/i.exec(name ?? '')?.[1] ?? '').toLowerCase();

/* ------------------------------------------------------------------ */
/* XLSX                                                                */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s) {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    // Escapes do próprio Excel para caracteres de controle (ex.: _x000D_).
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

/** Texto de um <si> ou <is>: junta os <t> (inclui texto com formatação), sem a leitura fonética (<rPh>). */
function richText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(clean))) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

/** "AB12" → 27 (índice da coluna, a partir de 0). */
function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref ?? '')?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Número como texto, sem ruído de ponto flutuante ("-21.390448000000001" → "-21.390448"). */
function numberText(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

function parseSheetXml(xml, shared) {
  const rows = [];
  const rowLines = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  let auto = 0;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = attr(rm[1], 'r');
    const line = rAttr ? Number(rAttr) : auto + 1;
    auto = line;
    const cells = [];
    const body = rm[2] ?? '';
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let col = -1;
    while ((cm = cellRe.exec(body))) {
      const ref = attr(cm[1], 'r');
      col = ref ? columnIndex(ref) : col + 1;
      const type = attr(cm[1], 't');
      const inner = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (type === 'str' || type === 'e') value = v != null ? decodeXml(v) : '';
      else if (type === 'b') value = v === '1' ? 'VERDADEIRO' : 'FALSO';
      else if (v != null) value = numberText(decodeXml(v));
      cells[col] = value.trim();
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
    rowLines.push(line);
  }
  return { rows, rowLines };
}

/**
 * Lê um .xlsx (ArrayBuffer/Uint8Array).
 * @returns {{ name: string, rows: string[][], rowLines: number[] }[]} uma entrada por aba, na ordem do arquivo
 */
export function parseXlsx(buffer) {
  let files;
  try {
    files = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  } catch {
    throw new Error('Não foi possível abrir a planilha Excel (arquivo corrompido ou protegido por senha).');
  }
  const text = (path) => (files[path] ? strFromU8(files[path]) : null);
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('O arquivo não parece ser uma planilha Excel (.xlsx).');

  const rels = new Map();
  const relXml = text('xl/_rels/workbook.xml.rels') ?? '';
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(m[0], 'Target') ?? '';
    rels.set(attr(m[0], 'Id'), target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const shared = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? richText(m[1]) : '');

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Aba ${sheets.length + 1}`;
    const state = attr(m[0], 'state');
    const path = rels.get(attr(m[0], 'r:id'));
    const xml = path ? text(path) : null;
    if (!xml || state === 'hidden' || state === 'veryHidden') continue;
    sheets.push({ name, ...parseSheetXml(xml, shared) });
  }
  if (!sheets.length) throw new Error('A planilha não tem abas visíveis com dados.');
  return sheets;
}

/* ------------------------------------------------------------------ */
/* Tabela: cabeçalho e linhas                                          */
/* ------------------------------------------------------------------ */

const filled = (row) => row.filter((c) => String(c ?? '').trim() !== '').length;

/**
 * Linha do cabeçalho: a primeira, entre as 15 primeiras, com pelo menos 60%
 * das colunas preenchidas (títulos de uma célula só ficam de fora).
 */
export function detectHeaderRow(rows) {
  const head = rows.slice(0, 15);
  const max = Math.max(0, ...head.map(filled));
  if (max < 2) return 0;
  const idx = head.findIndex((r) => filled(r) >= Math.max(2, Math.ceil(max * 0.6)));
  return idx < 0 ? 0 : idx;
}

/**
 * Converte linhas brutas em { headers, rows, rowLines }, como parseCsv.
 * Remove linhas vazias e colunas sem cabeçalho e sem dados no fim.
 */
export function tableFromRows(rawRows, rawLines) {
  const keep = [];
  const lines = [];
  rawRows.forEach((r, i) => {
    if (filled(r)) { keep.push(r.map((c) => String(c ?? '').trim())); lines.push(rawLines?.[i] ?? i + 1); }
  });
  if (!keep.length) return { headers: [], rows: [], rowLines: [], headerLine: null };
  const h = detectHeaderRow(keep);
  const width = Math.max(...keep.slice(h).map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return {
    headers: pad(keep[h]),
    rows: keep.slice(h + 1).map(pad),
    rowLines: lines.slice(h + 1),
    headerLine: lines[h],
  };
}

/** Quantas colunas o mapeamento automático reconhece (escolhe a aba padrão). */
const recognized = (headers) => Object.values(suggestMapping(headers)).filter((v) => v != null).length;

/**
 * Lê um arquivo de pontos (CSV/TXT/TSV ou XLSX).
 * @returns {Promise<{ format, encoding, sheets: {name, table}[], sheetIndex }>}
 *   table = { headers, rows, rowLines, headerLine, delimiter? }
 */
export async function readPointsFile(file) {
  const kind = ext(file.name);
  if (kind === 'xls') {
    throw new Error('Arquivo .xls (Excel 97-2003) não é lido. No Excel, use "Salvar como" → Pasta de Trabalho do Excel (.xlsx) ou CSV.');
  }
  if (kind === 'ods') throw new Error('Arquivo .ods não é lido. Salve como .xlsx ou .csv.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

  if (kind === 'xlsx' || kind === 'xlsm' || (isZip && kind !== 'csv')) {
    const sheets = parseXlsx(bytes).map((s) => ({ name: s.name, table: tableFromRows(s.rows, s.rowLines) }));
    const scored = sheets.map((s, i) => ({ i, score: recognized(s.table.headers) * 1e6 + s.table.rows.length }));
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
    return { format: 'xlsx', encoding: 'Excel (.xlsx)', sheets, sheetIndex: best.i };
  }

  const { text, encoding } = decodeBuffer(buffer);
  const parsed = parseCsv(text);
  const all = [parsed.headers, ...parsed.rows];
  const table = { ...tableFromRows(all, [1, ...parsed.rowLines]), delimiter: parsed.delimiter };
  return { format: 'csv', encoding, sheets: [{ name: null, table }], sheetIndex: 0 };
}
