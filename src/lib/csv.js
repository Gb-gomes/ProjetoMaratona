/**
 * Leitura e validação de CSV no navegador.
 *
 * Nada aqui envia dados para fora: o arquivo é lido com FileReader e
 * processado em memória. Nenhuma coordenada é registrada em log.
 */

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

const DELIMITERS = [',', ';', '\t'];

/** Conta ocorrências de um caractere fora de aspas. */
function countOutsideQuotes(line, ch) {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n += 1;
  }
  return n;
}

/**
 * Detecta o separador pelo cabeçalho e pelas primeiras linhas: escolhe o
 * caractere que aparece no cabeçalho e mantém a mesma contagem nas linhas.
 */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 6);
  if (!lines.length) return ',';
  let best = ',';
  let bestScore = -1;
  DELIMITERS.forEach((d) => {
    const head = countOutsideQuotes(lines[0], d);
    if (head === 0) return;
    const consistent = lines.slice(1).filter((l) => countOutsideQuotes(l, d) === head).length;
    const score = consistent * 1000 + head;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  });
  return best;
}

/**
 * Interpreta o texto de um CSV (RFC 4180): campos entre aspas podem conter
 * separadores, aspas duplicadas e quebras de linha. Remove o BOM.
 *
 * @returns {{delimiter:string, headers:string[], rows:string[][], rowLines:number[]}}
 *   rowLines[i] é a linha física do arquivo onde o registro i começa.
 */
export function parseCsv(text, delimiterOverride) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const delimiter = delimiterOverride ?? detectDelimiter(src);
  const records = [];
  const starts = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      records.push(row);
      starts.push(rowStart);
      row = [];
      cell = '';
      line += 1;
      rowStart = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    records.push(row);
    starts.push(rowStart);
  }

  const kept = [];
  const keptLines = [];
  records.forEach((r, i) => {
    if (r.some((c) => c.trim() !== '')) {
      kept.push(r.map((c) => c.trim()));
      keptLines.push(starts[i]);
    }
  });
  if (!kept.length) return { delimiter, headers: [], rows: [], rowLines: [] };
  return { delimiter, headers: kept[0], rows: kept.slice(1), rowLines: keptLines.slice(1) };
}

/**
 * Lê um File como texto. Tenta UTF-8 (estrito); se o arquivo não for
 * UTF-8 válido, usa Windows-1252, comum em CSVs exportados pelo Excel.
 * @returns {Promise<string>} (com a propriedade `encoding` no resultado de readFileWithEncoding)
 */
export async function readFileWithEncoding(file) {
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
  return decodeBuffer(buffer);
}

export function decodeBuffer(buffer) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'Windows-1252' };
  }
}

/** Compatibilidade com o modo demonstração. */
export async function readFileAsText(file) {
  return (await readFileWithEncoding(file)).text;
}

/* ------------------------------------------------------------------ */
/* Mapeamento de colunas                                               */
/* ------------------------------------------------------------------ */

/** Campos que o operador pode mapear. */
export const MAPPABLE_FIELDS = [
  { key: 'id', label: 'Identificador do ponto', required: false },
  { key: 'lat', label: 'Latitude', required: true },
  { key: 'lng', label: 'Longitude', required: true },
  { key: 'client', label: 'Cliente / unidade consumidora', required: false },
  { key: 'equipment', label: 'Equipamento', required: false },
  { key: 'property', label: 'Propriedade', required: false },
];

const SUGGESTIONS = {
  id: ['id', 'codigo', 'cod', 'ponto', 'id_ponto'],
  lat: ['lat', 'latitude', 'coord_y', 'y'],
  lng: ['lon', 'lng', 'long', 'longitude', 'coord_x', 'x'],
  client: ['cliente', 'uc', 'unidade_consumidora', 'cod_cliente', 'instalacao'],
  equipment: ['equipamento', 'equip', 'transformador', 'trafo', 'chave', 'poste'],
  property: ['propriedade', 'fazenda', 'nome_propriedade', 'imovel'],
};

/**
 * Sugere um mapeamento pelos nomes dos cabeçalhos. É apenas uma sugestão:
 * o operador confirma ou altera antes de validar.
 * @returns {Record<string, number|null>} campo → índice da coluna
 */
export function suggestMapping(headers) {
  const norm = headers.map(normalize);
  const used = new Set();
  const mapping = {};
  MAPPABLE_FIELDS.forEach(({ key }) => {
    // Na ordem das sugestões: "lat" ganha de "coord_y" mesmo que COORD_Y venha antes na planilha.
    let idx = -1;
    SUGGESTIONS[key].some((name) => {
      idx = norm.findIndex((h, i) => !used.has(i) && h === name);
      return idx >= 0;
    });
    mapping[key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  });
  return mapping;
}

/* ------------------------------------------------------------------ */
/* Detecção das coordenadas pelos valores                              */
/* ------------------------------------------------------------------ */

/** Colunas X e Y da planilha (letras do Excel): latitude e longitude no modelo da Energisa. */
export const TEMPLATE_LAT_COLUMN = 23; // X
export const TEMPLATE_LNG_COLUMN = 24; // Y

/** Letra da coluna da planilha ("X", "AB") a partir do índice (0 = A). */
export function columnLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Fração dos valores preenchidos da coluna que são graus decimais dentro do intervalo. */
function degreeShare(rows, idx, min, max, sample = 300) {
  if (idx == null || idx < 0) return 0;
  let filledCount = 0;
  let ok = 0;
  for (const row of rows.slice(0, sample)) {
    const raw = (row[idx] ?? '').trim();
    if (!raw) continue;
    filledCount += 1;
    const n = parseDecimal(raw);
    // Graus decimais têm casas decimais; UTM (metros) fica fora do intervalo.
    if (Number.isFinite(n) && n >= min && n <= max && /[.,]\d/.test(raw)) ok += 1;
  }
  return filledCount ? ok / filledCount : 0;
}

const latShare = (rows, idx) => degreeShare(rows, idx, -34, 5.5);
const lngShare = (rows, idx) => degreeShare(rows, idx, -74.1, -28.6);

/**
 * Mapeamento sugerido conferido pelos valores. Latitude e longitude só ficam
 * numa coluna que tenha graus decimais do Brasil; ordem de tentativa:
 *  1. o que os cabeçalhos sugerem (LAT, LONG, latitude…);
 *  2. as colunas X (latitude) e Y (longitude) do modelo da planilha;
 *  3. a primeira coluna com cara de latitude e a primeira com cara de longitude.
 * @returns {{ mapping: Record<string, number|null>, coordSource: 'cabecalho'|'colunas_xy'|'valores'|null }}
 */
export function suggestMappingFromData(headers, rows) {
  const mapping = suggestMapping(headers);
  const good = (lat, lng) => lat != null && lng != null && lat !== lng && latShare(rows, lat) >= 0.8 && lngShare(rows, lng) >= 0.8;
  if (good(mapping.lat, mapping.lng)) return { mapping, coordSource: 'cabecalho' };

  const take = (lat, lng, coordSource) => {
    const next = { ...mapping };
    // A coluna escolhida sai de outro campo que a tivesse pegado.
    Object.keys(next).forEach((k) => { if (k !== 'lat' && k !== 'lng' && (next[k] === lat || next[k] === lng)) next[k] = null; });
    return { mapping: { ...next, lat, lng }, coordSource };
  };
  if (headers.length > TEMPLATE_LNG_COLUMN && good(TEMPLATE_LAT_COLUMN, TEMPLATE_LNG_COLUMN)) {
    return take(TEMPLATE_LAT_COLUMN, TEMPLATE_LNG_COLUMN, 'colunas_xy');
  }
  const cols = headers.map((_, i) => i);
  const lat = cols.find((i) => latShare(rows, i) >= 0.8 && lngShare(rows, i) < 0.8);
  const lng = cols.find((i) => i !== lat && lngShare(rows, i) >= 0.8);
  if (lat != null && lng != null) return take(lat, lng, 'valores');
  return { mapping, coordSource: null };
}

/**
 * Referencial sugerido: com latitude e longitude em graus decimais do Brasil,
 * SIRGAS 2000 (EPSG:4674, padrão das bases brasileiras). O operador pode trocar.
 */
export function suggestCrs(rows, mapping) {
  if (mapping?.lat == null || mapping?.lng == null) return '';
  return latShare(rows, mapping.lat) >= 0.8 && lngShare(rows, mapping.lng) >= 0.8 ? 'EPSG:4674' : '';
}

/* ------------------------------------------------------------------ */
/* Referencial das coordenadas                                         */
/* ------------------------------------------------------------------ */

/**
 * Referenciais aceitos para processamento. SIRGAS 2000 geográfico e WGS84
 * diferem em poucos centímetros e são tratados como compatíveis com a
 * camada (convertida para EPSG:4326). Coordenadas projetadas (UTM) não são
 * convertidas nesta versão.
 */
export const CRS_OPTIONS = [
  { value: '', label: 'Selecione o referencial…', processable: false },
  { value: 'EPSG:4326', label: 'WGS84 — graus decimais (EPSG:4326)', processable: true },
  { value: 'EPSG:4674', label: 'SIRGAS 2000 — graus decimais (EPSG:4674)', processable: true },
  { value: 'projected', label: 'Projetado (UTM ou outro, em metros)', processable: false },
  { value: 'unknown', label: 'Desconhecido / a confirmar', processable: false },
];

export const isProcessableCrs = (crs) => !!CRS_OPTIONS.find((o) => o.value === crs)?.processable;

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

/** Retângulo aproximado do território brasileiro (para sinalizar inversões). */
export const BRAZIL_BBOX = { minLat: -34.0, maxLat: 5.5, minLng: -74.1, maxLng: -28.6 };
const inBrazil = (lat, lng) => lat >= BRAZIL_BBOX.minLat && lat <= BRAZIL_BBOX.maxLat
  && lng >= BRAZIL_BBOX.minLng && lng <= BRAZIL_BBOX.maxLng;

/**
 * Converte texto em número decimal. Aceita vírgula decimal ("-13,74")
 * e o sinal de menos tipográfico. Retorna NaN quando o formato é ambíguo
 * (vírgula e ponto juntos) ou não decimal (graus, minutos, letras).
 */
export function parseDecimal(value) {
  if (value == null) return NaN;
  let v = String(value).trim().replace(/−/g, '-');
  if (v === '') return NaN;
  if (v.includes(',') && v.includes('.')) return NaN;
  if (v.includes(',')) {
    if ((v.match(/,/g) || []).length > 1) return NaN;
    v = v.replace(',', '.');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v)) return NaN;
  return Number(v);
}

const cell = (row, idx) => (idx == null ? '' : (row[idx] ?? '').trim());

/**
 * Valida os registros conforme o mapeamento de colunas.
 *
 * Severidade:
 *  - error   → registro inválido, não entra no processamento;
 *  - warning → registro válido, mas sinalizado para revisão.
 *
 * Nenhuma coordenada é corrigida automaticamente (inclusive inversões).
 *
 * @param {{headers:string[], rows:string[][], rowLines?:number[]}} parsed
 * @param {Record<string, number|null>} mapping
 */
export function validateRecords(parsed, mapping) {
  const { headers = [], rows = [], rowLines = [] } = parsed ?? {};
  const fileProblems = [];

  if (!headers.length) fileProblems.push('O arquivo está vazio ou não pôde ser interpretado como CSV.');
  else if (!rows.length) fileProblems.push('O arquivo contém apenas o cabeçalho, sem registros.');
  if (headers.length && (mapping?.lat == null || mapping?.lng == null)) {
    const missing = [mapping?.lat == null && 'latitude', mapping?.lng == null && 'longitude'].filter(Boolean);
    fileProblems.push(`Mapeie a(s) coluna(s) obrigatória(s): ${missing.join(' e ')}.`);
  }
  if (mapping?.lat != null && mapping.lat === mapping.lng) {
    fileProblems.push('Latitude e longitude não podem usar a mesma coluna.');
  }
  if (fileProblems.length) {
    return {
      ok: false, fileProblems, records: [], total: rows.length, valid: 0, invalid: rows.length, warnings: 0,
    };
  }

  const seenIds = new Map();
  const seenRows = new Map();
  const seenCoords = new Map();

  const records = rows.map((row, i) => {
    const line = rowLines[i] ?? i + 2;
    const issues = [];
    const err = (code, message) => issues.push({ code, severity: 'error', message });
    const warn = (code, message) => issues.push({ code, severity: 'warning', message });

    const rawLat = cell(row, mapping.lat);
    const rawLng = cell(row, mapping.lng);
    const fields = {
      id: cell(row, mapping.id) || null,
      client: cell(row, mapping.client) || null,
      equipment: cell(row, mapping.equipment) || null,
      property: cell(row, mapping.property) || null,
    };

    if (row.length !== headers.length) {
      warn('column-count', `Linha com ${row.length} coluna(s); o cabeçalho tem ${headers.length}.`);
    }

    let lat = NaN;
    let lng = NaN;
    if (rawLat === '' || rawLng === '') {
      err('missing', `Coordenada ausente (${[rawLat === '' && 'latitude', rawLng === '' && 'longitude'].filter(Boolean).join(' e ')}).`);
    } else {
      lat = parseDecimal(rawLat);
      lng = parseDecimal(rawLng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        err('not-numeric', 'Valor não numérico ou fora do formato decimal (ex.: -13,7443 ou -13.7443).');
      } else if (Math.abs(lat) > 180 || Math.abs(lng) > 180) {
        err('projected', 'Valores fora da escala de graus: as coordenadas parecem projetadas (UTM ou similar). Confirme o referencial.');
      } else if (lat < -90 || lat > 90) {
        if (Math.abs(lng) <= 90 && inBrazil(lng, lat)) {
          err('swapped', 'Latitude fora do intervalo; os valores parecem invertidos (latitude ↔ longitude). Não foram corrigidos.');
        } else {
          err('lat-range', 'Latitude fora do intervalo válido (−90 a 90).');
        }
      } else if (lng < -180 || lng > 180) {
        err('lng-range', 'Longitude fora do intervalo válido (−180 a 180).');
      } else if (!inBrazil(lat, lng)) {
        if (inBrazil(lng, lat)) {
          err('swapped', 'Os valores parecem invertidos (latitude ↔ longitude). Não foram corrigidos.');
        } else {
          err('outside-brazil', 'Coordenada fora do território brasileiro. Confira o referencial e o sinal dos valores.');
        }
      }
    }

    const valid = !issues.some((x) => x.severity === 'error');

    // Duplicidades: só consideradas entre registros com coordenadas válidas.
    if (valid) {
      if (fields.id) {
        if (seenIds.has(fields.id)) {
          err('duplicate-id', `Identificador repetido (primeira ocorrência na linha ${seenIds.get(fields.id)}).`);
        } else {
          seenIds.set(fields.id, line);
        }
      }
      if (!issues.some((x) => x.code === 'duplicate-id')) {
        // Linha inteira (todas as colunas): unidades consumidoras diferentes no mesmo ponto e
        // transformador (NUMCDC, nome) não são "repetidas"; só a cópia exata da linha é.
        const rowKey = row.map((c) => String(c ?? '').trim()).join('\u0001');
        const coordKey = `${lat}|${lng}`;
        if (seenRows.has(rowKey)) {
          err('duplicate-row', `Registro repetido (idêntico à linha ${seenRows.get(rowKey)}).`);
        } else {
          seenRows.set(rowKey, line);
          if (seenCoords.has(coordKey)) {
            warn('duplicate-coord', `Mesma coordenada da linha ${seenCoords.get(coordKey)} (registro diferente).`);
          } else {
            seenCoords.set(coordKey, line);
          }
        }
      }
    }

    const status = issues.some((x) => x.severity === 'error') ? 'invalid' : 'valid';
    return {
      line,
      ...fields,
      lat: status === 'valid' ? lat : null,
      lng: status === 'valid' ? lng : null,
      status,
      issues,
    };
  });

  const valid = records.filter((r) => r.status === 'valid').length;
  const warnings = records.filter((r) => r.status === 'valid' && r.issues.length).length;
  return {
    ok: valid > 0,
    fileProblems: valid > 0 ? [] : ['Nenhum registro com coordenadas válidas.'],
    records,
    total: records.length,
    valid,
    invalid: records.length - valid,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Validação simplificada (modo demonstração)                          */
/* ------------------------------------------------------------------ */

/**
 * Usada no modo demonstração: confere o arquivo, mas a simulação continua
 * usando os pontos demonstrativos.
 */
export function validateCoordinates(parsed) {
  const mapping = suggestMapping(parsed.headers);
  const result = validateRecords(parsed, mapping);
  const missing = [mapping.lat == null && 'latitude', mapping.lng == null && 'longitude'].filter(Boolean);
  const problems = result.fileProblems.length && !result.records.length
    ? result.fileProblems
    : result.records.filter((r) => r.status === 'invalid').map((r) => `Linha ${r.line}: ${r.issues[0].message}`);
  return {
    ok: result.ok,
    total: result.total,
    valid: result.valid,
    invalid: result.invalid,
    latColumn: parsed.headers[mapping.lat],
    lngColumn: parsed.headers[mapping.lng],
    missing,
    problems,
  };
}
