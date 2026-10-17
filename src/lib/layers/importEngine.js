/**
 * Importação de camadas de dados: leitura, detecção do referencial,
 * reprojeção para EPSG:4326, correção de geometrias e relatório de
 * feições rejeitadas.
 *
 * Roda dentro do Web Worker (sem DOM). O KML/KMZ precisa de DOMParser e é
 * convertido para GeoJSON na thread principal (kmlToGeoJSON, em
 * layerImportClient.js) antes de chegar aqui.
 *
 * Formatos: GeoJSON, Shapefile (.zip), CSV com latitude/longitude
 * (ou E/N em UTM) e GeoJSON vindo de KML/KMZ. GeoPackage ainda não é
 * aceito (exige SQLite no navegador); a mensagem orienta a exportar.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { parseShp } from 'shpjs';
import { readDbf } from './dbf.js';
import {
  crsFromPrj, crsFromGeoJSON, crsByCode, looksProjected, makeTransform, transformGeometry, isIdentity,
} from './crs.js';
import { parseCsv, decodeBuffer, parseDecimal } from '../csv.js';
import { unionGeometries } from '../geoOps.js';

export const ACCEPTED_EXTENSIONS = '.geojson,.json,.zip,.kml,.kmz,.csv,.gpkg';

export function detectKind(fileName) {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? '')?.[1]?.toLowerCase();
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  if (ext === 'zip') return 'shapefile';
  if (ext === 'kml') return 'kml';
  if (ext === 'kmz') return 'kmz';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'gpkg') return 'gpkg';
  return null;
}

export const KIND_LABEL = {
  geojson: 'GeoJSON', shapefile: 'Shapefile (.zip)', kml: 'KML', kmz: 'KMZ', csv: 'CSV', gpkg: 'GeoPackage',
};

/* ------------------------------------------------------------------ */
/* Leitura das fontes                                                  */
/* ------------------------------------------------------------------ */

/** Lista os shapefiles de um .zip (nomes sem extensão). */
export function listShapefiles(zip) {
  return Object.keys(zip)
    .filter((k) => !k.includes('__MACOSX') && k.toLowerCase().endsWith('.shp'))
    .map((k) => k.slice(0, -4));
}

const pick = (zip, base, ext) => zip[`${base}.${ext}`] ?? zip[`${base}.${ext.toUpperCase()}`];

/**
 * Lê um Shapefile compactado.
 * @returns {{ features, prj, crs, layers: string[], layerName }}
 */
export function readShapefileZip(bytes, { layerName = null } = {}) {
  let zip;
  try {
    zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new Error('O arquivo .zip está corrompido ou não pôde ser aberto.');
  }
  const layers = listShapefiles(zip);
  if (!layers.length) throw new Error('O .zip não contém nenhum arquivo .shp.');
  const base = layerName && layers.includes(layerName) ? layerName : layers[0];
  if (!pick(zip, base, 'dbf')) throw new Error(`Falta o arquivo ${base}.dbf (atributos) no .zip.`);
  const prjBytes = pick(zip, base, 'prj');
  const prj = prjBytes ? strFromU8(prjBytes) : null;
  const cpgBytes = pick(zip, base, 'cpg');
  const geoms = parseShp(pick(zip, base, 'shp'));
  const { rows, encoding } = readDbf(pick(zip, base, 'dbf'), cpgBytes ? strFromU8(cpgBytes) : undefined);
  const features = geoms.map((geometry, i) => ({ type: 'Feature', geometry, properties: rows[i] ?? {} }));
  return {
    features, prj, crs: prj ? crsFromPrj(prj) : null, layers, layerName: base.split('/').pop(), encoding,
  };
}

/** Lê GeoJSON (texto ou objeto). */
export function readGeoJSON(input) {
  let gj = input;
  if (typeof input === 'string') {
    try {
      gj = JSON.parse(input.replace(/^﻿/, ''));
    } catch {
      throw new Error('O arquivo não é um JSON válido.');
    }
  }
  let features;
  if (gj?.type === 'FeatureCollection' && Array.isArray(gj.features)) features = gj.features;
  else if (gj?.type === 'Feature') features = [gj];
  else if (gj?.type && gj.coordinates) features = [{ type: 'Feature', geometry: gj, properties: {} }];
  else throw new Error('O JSON não é um GeoJSON (FeatureCollection, Feature ou geometria).');
  return { features, crs: crsFromGeoJSON(gj) };
}

/** Sugestão das colunas de coordenadas de um CSV. */
export function suggestCsvColumns(headers) {
  const norm = headers.map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
  const find = (cands) => norm.findIndex((h) => cands.includes(h));
  return {
    x: find(['longitude', 'lon', 'lng', 'long', 'x', 'leste', 'e', 'este', 'utm_e', 'coord_x']),
    y: find(['latitude', 'lat', 'y', 'norte', 'n', 'utm_n', 'coord_y']),
  };
}

/** CSV → features de ponto (as demais colunas viram atributos). */
export function readCsv(bytes, { xColumn, yColumn } = {}) {
  const { text, encoding } = decodeBuffer(bytes);
  const parsed = parseCsv(text);
  if (parsed.headers.length < 2) throw new Error('CSV sem colunas suficientes. Confira o separador.');
  const suggestion = suggestCsvColumns(parsed.headers);
  const xi = xColumn ?? suggestion.x;
  const yi = yColumn ?? suggestion.y;
  const base = {
    headers: parsed.headers, suggestion, encoding, delimiter: parsed.delimiter, rowCount: parsed.rows.length,
  };
  if (xi == null || yi == null || xi < 0 || yi < 0) return { ...base, features: null, needsColumns: true };
  const features = parsed.rows.map((row, i) => {
    const properties = {};
    parsed.headers.forEach((h, c) => { if (c !== xi && c !== yi) properties[h || `coluna_${c + 1}`] = row[c] ?? ''; });
    const x = parseDecimal(row[xi]);
    const y = parseDecimal(row[yi]);
    return {
      type: 'Feature',
      properties,
      geometry: Number.isFinite(x) && Number.isFinite(y) ? { type: 'Point', coordinates: [x, y] } : null,
      _line: parsed.rowLines[i],
    };
  });
  return { ...base, features, needsColumns: false };
}

/* ------------------------------------------------------------------ */
/* Correção e validação de geometrias                                  */
/* ------------------------------------------------------------------ */

const finitePair = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const dedupe = (coords) => coords.filter((c, i) => i === 0 || !samePoint(c, coords[i - 1])).map((c) => [c[0], c[1]]);

function cleanRing(ring) {
  if (!Array.isArray(ring) || !ring.every(finitePair)) return { ring: null, fixed: false };
  let r = dedupe(ring);
  let fixed = r.length !== ring.length;
  if (r.length && !samePoint(r[0], r[r.length - 1])) { r = [...r, r[0]]; fixed = true; }
  return { ring: r.length >= 4 ? r : null, fixed };
}

/* Detecção de autointerseção em um anel (índice de grade simples). */
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c); const o2 = o(a, b, d); const o3 = o(c, d, a); const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
export function ringSelfIntersects(ring) {
  const n = ring.length - 1;
  if (n < 4) return false;
  if (n <= 400) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue;
        if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
      }
    }
    return false;
  }
  // Anéis grandes: grade uniforme para limitar as comparações.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  const cells = Math.ceil(Math.sqrt(n));
  const cw = (maxX - minX) / cells || 1;
  const ch = (maxY - minY) / cells || 1;
  const grid = new Map();
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]; const b = ring[i + 1];
    const x0 = Math.floor((Math.min(a[0], b[0]) - minX) / cw); const x1 = Math.floor((Math.max(a[0], b[0]) - minX) / cw);
    const y0 = Math.floor((Math.min(a[1], b[1]) - minY) / ch); const y1 = Math.floor((Math.max(a[1], b[1]) - minY) / ch);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = gx * 100003 + gy;
        const list = grid.get(key);
        if (list) {
          for (const j of list) {
            const adjacent = Math.abs(i - j) <= 1 || (Math.min(i, j) === 0 && Math.max(i, j) === n - 1);
            if (!adjacent && segmentsCross(a, b, ring[j], ring[j + 1])) return true;
          }
          list.push(i);
        } else grid.set(key, [i]);
      }
    }
  }
  return false;
}

/**
 * Corrige o que for seguro e rejeita o resto (equivalente simplificado ao ST_MakeValid).
 * @returns {{ geometry: object|null, fixed: string|null, reason: string|null }}
 */
export function repairGeometry(g) {
  if (!g || !g.type) return { geometry: null, fixed: null, reason: 'Geometria ausente' };
  switch (g.type) {
    case 'Point':
      return finitePair(g.coordinates) ? { geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }, fixed: null, reason: null }
        : { geometry: null, fixed: null, reason: 'Coordenada inválida' };
    case 'MultiPoint': {
      const pts = (g.coordinates ?? []).filter(finitePair).map((c) => [c[0], c[1]]);
      if (!pts.length) return { geometry: null, fixed: null, reason: 'Coordenadas inválidas' };
      return { geometry: { type: 'MultiPoint', coordinates: pts }, fixed: pts.length !== g.coordinates.length ? 'pontos inválidos removidos' : null, reason: null };
    }
    case 'LineString':
    case 'MultiLineString': {
      const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates) ?? [];
      if (!lines.every((l) => Array.isArray(l) && l.every(finitePair))) return { geometry: null, fixed: null, reason: 'Coordenadas inválidas' };
      const kept = lines.map(dedupe).filter((l) => l.length >= 2);
      if (!kept.length) return { geometry: null, fixed: null, reason: 'Linha com menos de 2 pontos distintos' };
      const fixed = kept.length !== lines.length || kept.some((l, i) => l.length !== lines[i]?.length) ? 'vértices repetidos removidos' : null;
      return { geometry: kept.length === 1 ? { type: 'LineString', coordinates: kept[0] } : { type: 'MultiLineString', coordinates: kept }, fixed, reason: null };
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) ?? [];
      let fixedAny = false;
      const kept = [];
      for (const poly of polys) {
        const rings = (poly ?? []).map(cleanRing);
        if (rings.some((r) => r.fixed)) fixedAny = true;
        if (!rings[0]?.ring) { fixedAny = true; continue; }
        const holes = rings.slice(1).map((r) => r.ring).filter(Boolean);
        if (holes.length !== rings.length - 1) fixedAny = true;
        kept.push([rings[0].ring, ...holes]);
      }
      if (!kept.length) return { geometry: null, fixed: null, reason: 'Polígono com menos de 3 vértices distintos' };
      const geometry = kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept };
      if (kept.some((poly) => poly.some(ringSelfIntersects))) {
        try {
          const valid = unionGeometries([geometry]);
          if (!valid) return { geometry: null, fixed: null, reason: 'Autointerseção que não pôde ser corrigida' };
          return { geometry: valid.coordinates.length === 1 ? { type: 'Polygon', coordinates: valid.coordinates[0] } : valid, fixed: 'autointerseção corrigida', reason: null };
        } catch {
          return { geometry: null, fixed: null, reason: 'Autointerseção que não pôde ser corrigida' };
        }
      }
      return { geometry, fixed: fixedAny ? 'anéis fechados/vértices repetidos removidos' : null, reason: null };
    }
    case 'GeometryCollection':
      return { geometry: null, fixed: null, reason: 'GeometryCollection não é aceita (separe as geometrias)' };
    default:
      return { geometry: null, fixed: null, reason: `Tipo de geometria desconhecido: ${g.type}` };
  }
}

export const GEOMETRY_FAMILY = {
  Point: 'point', MultiPoint: 'point', LineString: 'line', MultiLineString: 'line', Polygon: 'polygon', MultiPolygon: 'polygon',
};
export const FAMILY_LABEL = { point: 'pontos', line: 'linhas', polygon: 'polígonos', mixed: 'misto' };

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

function coordinateSample(features, max = 200) {
  const out = [];
  for (let i = 0; i < features.length && out.length < max; i += 1) {
    const g = features[i].geometry;
    if (!g?.coordinates) continue;
    let c = g.coordinates;
    while (Array.isArray(c[0])) [c] = c;
    if (finitePair(c)) out.push(c);
  }
  return out;
}

function inferType(values) {
  let num = 0; let bool = 0; let date = 0; let str = 0;
  values.forEach((v) => {
    if (typeof v === 'number') num += 1;
    else if (typeof v === 'boolean') bool += 1;
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) date += 1;
    else if (typeof v === 'string' && v !== '' && Number.isFinite(parseDecimal(v))) num += 1;
    else str += 1;
  });
  const total = num + bool + date + str;
  if (!total) return 'string';
  if (num === total) return 'number';
  if (bool === total) return 'boolean';
  if (date === total) return 'date';
  return 'string';
}

/** Inventário dos atributos (tipo, preenchimento, exemplos) nas primeiras N feições. */
export function inventoryAttributes(features, max = 5000) {
  const fields = new Map();
  const n = Math.min(features.length, max);
  for (let i = 0; i < n; i += 1) {
    const p = features[i].properties ?? {};
    Object.keys(p).forEach((k) => {
      if (!fields.has(k)) fields.set(k, { name: k, values: [], filled: 0 });
      const f = fields.get(k);
      const v = p[k];
      if (v !== null && v !== undefined && v !== '') {
        f.filled += 1;
        if (f.values.length < 300) f.values.push(v);
      }
    });
  }
  return [...fields.values()].map((f) => ({
    name: f.name,
    type: inferType(f.values),
    filledRatio: n ? f.filled / n : 0,
    samples: [...new Set(f.values.map(String))].slice(0, 3),
  }));
}

/**
 * Normaliza features já lidas: reprojeta, corrige, rejeita e resume.
 *
 * @param {object[]} features
 * @param {{ crs, onProgress }} options  crs: { code, def, name }
 * @returns {{ features, rejected, stats }}
 */
export function normalizeFeatures(features, { crs, onProgress } = {}) {
  const transform = crs && !isIdentity(crs.code) ? makeTransform(crs) : null;
  const out = [];
  const rejected = [];
  let fixed = 0;
  const families = { point: 0, line: 0, polygon: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const step = Math.max(1, Math.floor(features.length / 50));

  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
    const ref = f._line ? `linha ${f._line}` : `feição ${i + 1}`;
    const r = repairGeometry(f.geometry);
    if (!r.geometry) {
      rejected.push({ index: i, ref, reason: r.reason });
    } else {
      if (transform) {
        try {
          transformGeometry(r.geometry, transform);
        } catch {
          rejected.push({ index: i, ref, reason: 'Falha na reprojeção' });
          continue;
        }
      }
      // Faixa válida de graus depois da reprojeção.
      let bad = false;
      let fx0 = Infinity; let fy0 = Infinity; let fx1 = -Infinity; let fy1 = -Infinity;
      const visit = (c) => {
        if (typeof c[0] === 'number') {
          if (!(Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) bad = true;
          if (c[0] < fx0) fx0 = c[0]; if (c[1] < fy0) fy0 = c[1];
          if (c[0] > fx1) fx1 = c[0]; if (c[1] > fy1) fy1 = c[1];
          return;
        }
        for (let k = 0; k < c.length; k += 1) visit(c[k]);
      };
      visit(r.geometry.coordinates);
      if (bad) {
        rejected.push({ index: i, ref, reason: 'Coordenadas fora da faixa de graus (referencial incorreto?)' });
      } else {
        if (r.fixed) fixed += 1;
        families[GEOMETRY_FAMILY[r.geometry.type]] += 1;
        minX = Math.min(minX, fx0); minY = Math.min(minY, fy0); maxX = Math.max(maxX, fx1); maxY = Math.max(maxY, fy1);
        out.push({ type: 'Feature', geometry: r.geometry, properties: f.properties ?? {} });
      }
    }
    if (onProgress && i % step === 0) onProgress(i / features.length);
  }
  const present = Object.entries(families).filter(([, n]) => n > 0).map(([k]) => k);
  return {
    features: out,
    rejected,
    stats: {
      total: features.length,
      accepted: out.length,
      rejected: rejected.length,
      fixed,
      families,
      geometryType: present.length === 1 ? present[0] : present.length ? 'mixed' : null,
      bbox: out.length ? [minX, minY, maxX, maxY] : null,
    },
  };
}

/**
 * Etapa 1 da importação: lê o arquivo e decide o referencial.
 * Não reprojeta ainda; devolve o que a pré-visualização precisa saber.
 *
 * @param {{ kind, bytes?, geojson?, fileName, options: { layerName?, xColumn?, yColumn?, crsCode? } }} input
 */
export function readSource({ kind, bytes, geojson, options = {} }) {
  let features;
  let crs = null;
  const extra = {};
  if (kind === 'gpkg') {
    throw new Error('GeoPackage ainda não é aceito nesta versão. Exporte a camada como Shapefile (.zip) ou GeoJSON no QGIS.');
  } else if (kind === 'shapefile') {
    const shp = readShapefileZip(bytes, { layerName: options.layerName });
    features = shp.features;
    crs = shp.crs;
    extra.shapefiles = shp.layers;
    extra.layerName = shp.layerName;
    extra.prjDeclared = shp.crs?.declared ?? null;
  } else if (kind === 'geojson') {
    const gj = readGeoJSON(geojson ?? strFromU8(new Uint8Array(bytes)));
    features = gj.features;
    crs = gj.crs;
  } else if (kind === 'kml' || kind === 'kmz') {
    // Convertido na thread principal; KML é sempre WGS 84.
    features = readGeoJSON(geojson).features;
    crs = { ...crsByCode('EPSG:4326'), source: 'kml' };
  } else if (kind === 'csv') {
    const csv = readCsv(bytes, options);
    extra.csv = {
      headers: csv.headers, suggestion: csv.suggestion, encoding: csv.encoding, rowCount: csv.rowCount, xColumn: options.xColumn ?? csv.suggestion.x, yColumn: options.yColumn ?? csv.suggestion.y,
    };
    if (csv.needsColumns) return { features: [], crs: null, needsColumns: true, needsCrs: false, ...extra };
    features = csv.features;
  } else {
    throw new Error('Formato não reconhecido. Use GeoJSON, KML/KMZ, Shapefile (.zip) ou CSV.');
  }

  const sample = coordinateSample(features);
  const projected = looksProjected(sample);
  // Escolha explícita do usuário sempre prevalece.
  if (options.crsCode) {
    const chosen = crsByCode(options.crsCode);
    if (!chosen) throw new Error(`Referencial desconhecido: ${options.crsCode}`);
    crs = { ...chosen, source: 'usuario' };
  } else if (!crs && !projected && kind === 'geojson') {
    // GeoJSON RFC 7946 sem "crs": WGS 84.
    crs = { ...crsByCode('EPSG:4326'), source: 'rfc7946' };
  }
  const needsCrs = !crs?.def || (crs.source !== 'usuario' && kind === 'csv');
  return {
    features, crs, needsCrs, needsColumns: false, looksProjected: projected, ...extra,
  };
}
