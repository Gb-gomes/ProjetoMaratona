/**
 * Leitura e validação de CSV no navegador.
 *
 * Nada aqui envia dados para fora: o arquivo é lido com FileReader e
 * processado em memória. Nenhuma coordenada é registrada em log.
 */

import {
  FARM_FAR_METERS, METHOD_TEXT, describeFarm, distanceMeters,
} from './farmIndex.js';

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

/**
 * Campos que o operador pode mapear. A linha precisa de latitude e longitude
 * OU de algo que identifique a fazenda: aí o ponto vem do índice de fazendas
 * (lib/farmIndex.js).
 */
export const MAPPABLE_FIELDS = [
  { key: 'id', label: 'Identificador do ponto', required: false },
  { key: 'lat', label: 'Latitude', required: false, group: 'coords' },
  { key: 'lng', label: 'Longitude', required: false, group: 'coords' },
  { key: 'client', label: 'Cliente / unidade consumidora', required: false },
  { key: 'equipment', label: 'Equipamento / transformador', required: false },
  { key: 'property', label: 'Propriedade / fazenda', required: false },
  { key: 'car', label: 'Código CAR', required: false, group: 'farm' },
  { key: 'incra', label: 'Código INCRA', required: false, group: 'farm' },
  { key: 'municipality', label: 'Município', required: false },
  { key: 'catalogId', label: 'ID no catálogo de fazendas', required: false, group: 'farm' },
];

const SUGGESTIONS = {
  id: ['id', 'codigo', 'cod', 'ponto', 'id_ponto', 'cod_ponto', 'item'],
  lat: ['lat', 'latitude', 'coord_y', 'y', 'lat_dec', 'latitude_graus', 'lat_graus', 'latitude_decimal'],
  lng: ['lon', 'lng', 'long', 'longitude', 'coord_x', 'x', 'lon_dec', 'longitude_graus', 'lon_graus', 'long_graus', 'longitude_decimal'],
  client: ['cliente', 'uc', 'unidade_consumidora', 'cod_cliente', 'instalacao', 'cod_uc', 'codigo_uc', 'num_uc', 'numero_uc', 'n_uc', 'no_uc', 'conta_contrato'],
  equipment: ['equipamento', 'equip', 'transformador', 'trafo', 'chave', 'poste', 'cod_trafo', 'codigo_trafo', 'cod_transformador'],
  property: ['propriedade', 'fazenda', 'nome_propriedade', 'imovel', 'nome_fazenda', 'nome_imovel', 'sitio', 'denominacao'],
  car: ['car', 'codigo_car', 'cod_car', 'car_imovel', 'recibo_car', 'numero_car', 'n_car', 'cod_imovel_car', 'inscricao_car'],
  incra: ['incra', 'codigo_incra', 'cod_incra', 'ccir', 'sncr', 'codigo_imovel_incra', 'cod_imovel_incra', 'codigo_sncr'],
  municipality: ['municipio', 'cidade', 'mun', 'cod_ibge', 'cd_mun', 'nome_municipio', 'nm_mun', 'cod_municipio'],
  catalogId: ['id_catalogo', 'catalogo', 'cod_catalogo'],
};

const STOP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
/** Cabeçalho comparável: sem acento, minúsculo, sem "da/do/de", separadores viram "_" ("Nome da Fazenda" → "nome_fazenda"). */
const headerKey = (h) => normalize(h).split(/[^a-z0-9]+/).filter((w) => w && !STOP_WORDS.has(w)).join('_');

/**
 * Segunda tentativa, por palavra do cabeçalho ("Latitude (graus)", "Nº da UC",
 * "Código do imóvel no CAR"). Ordem importa: o primeiro campo que reconhece fica com a coluna.
 */
const KEYWORDS = [
  ['lat', ['latitude', 'lat']],
  ['lng', ['longitude', 'long', 'lon', 'lng']],
  ['car', ['car', 'sicar']],
  ['incra', ['incra', 'ccir', 'sncr', 'sigef']],
  ['municipality', ['municipio', 'cidade']],
  ['catalogId', ['catalogo']],
  ['property', ['fazenda', 'propriedade', 'imovel', 'sitio', 'chacara']],
  ['client', ['uc', 'cliente', 'instalacao', 'consumidora']],
  ['equipment', ['transformador', 'trafo', 'equipamento', 'chave']],
];

/** O mapeamento tem coordenadas? E algo que localize a fazenda? */
export const hasCoordMapping = (m) => m?.lat != null && m?.lng != null;
export const hasFarmMapping = (m) => ['catalogId', 'car', 'incra', 'property', 'equipment'].some((k) => m?.[k] != null);

/**
 * Sugere um mapeamento pelos nomes dos cabeçalhos. É apenas uma sugestão:
 * o operador confirma ou altera antes de validar.
 * @returns {Record<string, number|null>} campo → índice da coluna
 */
export function suggestMapping(headers) {
  const norm = headers.map(headerKey);
  const used = new Set();
  const mapping = {};
  MAPPABLE_FIELDS.forEach(({ key }) => {
    const idx = norm.findIndex((h, i) => !used.has(i) && SUGGESTIONS[key].includes(h));
    mapping[key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  });
  KEYWORDS.forEach(([key, words]) => {
    if (mapping[key] != null) return;
    const idx = norm.findIndex((h, i) => !used.has(i) && h.split('_').some((w) => words.includes(w)));
    if (idx >= 0) { mapping[key] = idx; used.add(idx); }
  });
  return mapping;
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
 * Ligação com a fazenda (quando `farms` é informado e a linha cita a fazenda
 * pelo ID do catálogo, CAR, INCRA, nome ou transformador):
 *  - linha SEM coordenada válida → o ponto passa a ser o da fazenda
 *    (coordOrigin 'fazenda'); se a coordenada do arquivo existia mas era
 *    inválida, isso fica registrado como alerta;
 *  - linha COM coordenada → a fazenda é só conferida: ponto a mais de
 *    FARM_FAR_METERS da fazenda citada vira alerta (o ponto do arquivo vale);
 *  - fazenda não encontrada ou ambígua (mais de uma possível) → erro com o
 *    motivo e os candidatos, para o operador completar a linha.
 *
 * @param {{headers:string[], rows:string[][], rowLines?:(number|string)[]}} parsed
 * @param {Record<string, number|null>} mapping
 * @param {{ farms?: ReturnType<import('./farmIndex.js').createFarmIndex> }} [options]
 */
export function validateRecords(parsed, mapping, { farms = null } = {}) {
  const { headers = [], rows = [], rowLines = [] } = parsed ?? {};
  const fileProblems = [];
  const coordsMapped = hasCoordMapping(mapping);
  const farmMapped = hasFarmMapping(mapping);

  if (!headers.length) fileProblems.push('O arquivo está vazio ou não pôde ser interpretado como CSV.');
  else if (!rows.length) fileProblems.push('O arquivo contém apenas o cabeçalho, sem registros.');
  if (headers.length && !coordsMapped) {
    if (mapping?.lat != null || mapping?.lng != null) {
      fileProblems.push(`Mapeie a(s) coluna(s) obrigatória(s): ${mapping?.lat == null ? 'latitude' : 'longitude'}.`);
    } else if (!farmMapped) {
      fileProblems.push('Mapeie as colunas de latitude e longitude, ou uma coluna que identifique a fazenda (código CAR, código INCRA ou nome da fazenda).');
    }
  }
  if (mapping?.lat != null && mapping.lat === mapping.lng) {
    fileProblems.push('Latitude e longitude não podem usar a mesma coluna.');
  }
  if (fileProblems.length) {
    return {
      ok: false, fileProblems, records: [], total: rows.length, valid: 0, invalid: rows.length, warnings: 0, fromFarm: 0, farmChecked: 0,
    };
  }

  const seenIds = new Map();
  const seenRows = new Map();
  const seenCoords = new Map();

  const records = rows.map((row, i) => {
    const line = rowLines[i] ?? i + 2;
    let issues = [];
    const err = (code, message) => issues.push({ code, severity: 'error', message });
    const warn = (code, message) => issues.push({ code, severity: 'warning', message });

    const rawLat = cell(row, mapping.lat);
    const rawLng = cell(row, mapping.lng);
    const fields = {
      id: cell(row, mapping.id) || null,
      client: cell(row, mapping.client) || null,
      equipment: cell(row, mapping.equipment) || null,
      property: cell(row, mapping.property) || null,
      car: cell(row, mapping.car) || null,
      incra: cell(row, mapping.incra) || null,
      municipality: cell(row, mapping.municipality) || null,
      catalogId: cell(row, mapping.catalogId) || null,
    };

    if (row.length !== headers.length) {
      warn('column-count', `Linha com ${row.length} coluna(s); o cabeçalho tem ${headers.length}.`);
    }

    let lat = NaN;
    let lng = NaN;
    if (!coordsMapped || (rawLat === '' && rawLng === '')) {
      err('missing', 'Coordenada ausente (latitude e longitude).');
    } else if (rawLat === '' || rawLng === '') {
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

    // Fazenda citada na linha.
    let coordOrigin = 'arquivo';
    let farm = null;
    let farmMethod = null;
    const coordOk = !issues.some((x) => x.severity === 'error');
    const keys = {
      catalogId: fields.catalogId,
      car: fields.car,
      incra: fields.incra,
      property: fields.property,
      municipality: fields.municipality,
      // O transformador só localiza a fazenda quando falta a coordenada (um transformador atende várias).
      equipment: coordOk ? null : fields.equipment,
    };
    const citesFarm = !!(keys.catalogId || keys.car || keys.incra || keys.property || keys.equipment);
    if (farms && citesFarm) {
      const res = farms.find(keys);
      if (res.farm) {
        farm = res.farm;
        farmMethod = res.method;
        if (coordOk) {
          const d = distanceMeters(lat, lng, farm.lat, farm.lng);
          if (d > FARM_FAR_METERS) {
            warn('farm-far', `Ponto a ${(d / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km da fazenda citada (${describeFarm(farm)}). Vale a coordenada do arquivo; confira.`);
          }
        } else {
          const coordProblem = issues.find((x) => x.severity === 'error' && x.code !== 'missing');
          issues = issues.filter((x) => x.severity !== 'error');
          if (coordProblem) warn('farm-replaced', `Coordenada do arquivo inválida (${coordProblem.message}) Usado o ponto da fazenda.`);
          lat = farm.lat;
          lng = farm.lng;
          coordOrigin = 'fazenda';
        }
      } else if (!coordOk) {
        // O motivo principal passa a ser a fazenda (a falta da coordenada já está implícita).
        issues = issues.filter((x) => x.code !== 'missing');
        const how = res.method ? METHOD_TEXT[res.method] : null;
        if (res.candidates.length > 1) {
          const list = res.candidates.slice(0, 3).map(describeFarm).join('; ');
          err('farm-ambiguous', `${res.candidates.length} fazendas possíveis pelo ${how}: ${list}${res.candidates.length > 3 ? '…' : ''}. Informe o CAR, o município ou a coordenada.`);
        } else {
          err('farm-not-found', `Fazenda não encontrada no catálogo (procurado por ${res.tried.map((m) => METHOD_TEXT[m]).join(', ')}). Informe a coordenada.`);
        }
      }
    } else if (!coordOk && citesFarm && !farms) {
      err('farm-index', 'Índice de fazendas não carregado: não foi possível localizar a fazenda.');
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
        const rowKey = [lat, lng, fields.id, fields.client, fields.equipment, fields.property, fields.car].join('|');
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
      // Sem nome de propriedade no arquivo, vale o nome da fazenda do catálogo.
      property: fields.property ?? farm?.nome ?? null,
      lat: status === 'valid' ? lat : null,
      lng: status === 'valid' ? lng : null,
      coordOrigin: status === 'valid' ? coordOrigin : null,
      farm: farm ? {
        id: farm.id, nome: farm.nome, car: farm.car, incra: farm.incra, mun: farm.mun, municipio: farm.municipio,
      } : null,
      farmMethod,
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
    fromFarm: records.filter((r) => r.coordOrigin === 'fazenda').length,
    farmChecked: records.filter((r) => r.coordOrigin === 'arquivo' && r.farm).length,
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
