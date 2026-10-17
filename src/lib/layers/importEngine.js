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
import { repairGeometry, finitePair } from './geometryRepair.js';
import {
  crsFromPrj, crsFromGeoJSON, crsByCode, looksProjected, makeTransform, transformGeometry, isIdentity,
} from './crs.js';
import { parseCsv, decodeBuffer, parseDecimal } from '../csv.js';

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

// Correção de geometrias: módulo próprio (também usado fora do Worker).
export { repairGeometry, ringSelfIntersects } from './geometryRepair.js';

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
