/**
 * Web Worker das camadas de dados: importação, índice de tiles, cliques,
 * resumos e filtros. Mantém o trabalho pesado fora da thread da interface,
 * para o mapa não travar com centenas de milhares de feições.
 *
 * Protocolo: { id, type, payload } → { id, kind: 'progress' | 'result' | 'error', ... }
 */
import {
  readSource, normalizeFeatures, inventoryAttributes, GEOMETRY_FAMILY,
} from './importEngine.js';
import { geometryBboxAny } from '../geoOps.js';
import {
  buildIndex, packTile, hitTest, featureBoxes, summarizeInside, filterInside, fieldStats,
} from './dataEngine.js';
import { readFeatures, writeFeatures } from './layerStore.js';

const imports = new Map(); // jobId → { raw, read, normalized, options }
const opened = new Map(); // `${layerId}@${version}` → { features, index, boxes }
const filtered = new Map(); // `${key}#${regionKey}` → { features, index, boxes }

const keyOf = (layerId, version) => `${layerId}@${version}`;

/** Contagem por tipo de geometria e caixa envolvente total. */
function describeFeatures(features) {
  const families = { point: 0, line: 0, polygon: 0 };
  let bbox = null;
  features.forEach((f) => {
    families[GEOMETRY_FAMILY[f.geometry.type]] += 1;
    const b = geometryBboxAny(f.geometry);
    bbox = bbox ? [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])] : b;
  });
  const present = Object.entries(families).filter(([, n]) => n).map(([k]) => k);
  return {
    featureCount: features.length, bbox, families, geometryType: present.length === 1 ? present[0] : 'mixed',
  };
}

function post(id, kind, data, transfer) {
  self.postMessage({ id, kind, ...data }, transfer ?? []);
}

function previewOf(job) {
  const { normalized, read } = job;
  const sample = [];
  const step = Math.max(1, Math.floor(normalized.features.length / 1500));
  for (let i = 0; i < normalized.features.length && sample.length < 1500; i += step) sample.push(normalized.features[i]);
  return {
    stats: normalized.stats,
    rejected: normalized.rejected.slice(0, 1000),
    rejectedTotal: normalized.rejected.length,
    attributes: inventoryAttributes(normalized.features),
    sample,
    crs: read.crs ? { code: read.crs.code, name: read.crs.name, source: read.crs.source } : null,
    shapefiles: read.shapefiles ?? null,
    layerName: read.layerName ?? null,
    prjDeclared: read.prjDeclared ?? null,
    csv: read.csv ?? null,
  };
}

const opening = new Map(); // carregamentos em andamento (vários tiles pedem a mesma camada ao mesmo tempo)

async function ensureOpen(layerId, version, onProgress) {
  const key = keyOf(layerId, version);
  if (opened.has(key)) return opened.get(key);
  if (!opening.has(key)) {
    opening.set(key, readFeatures(layerId, version, onProgress).then((features) => {
      const entry = { features, index: buildIndex(features), boxes: featureBoxes(features) };
      opened.set(key, entry);
      return entry;
    }).finally(() => opening.delete(key)));
  }
  return opening.get(key);
}

const target = (layerId, version, regionKey) => (regionKey ? filtered.get(`${keyOf(layerId, version)}#${regionKey}`) : opened.get(keyOf(layerId, version)));

const handlers = {
  'import:read': async ({ jobId, kind, bytes, geojson, options = {} }, progress) => {
    progress(0.05, 'Lendo o arquivo');
    const prev = imports.get(jobId);
    const read = readSource({
      kind, bytes: bytes ?? prev?.bytes, geojson: geojson ?? prev?.geojson, options,
    });
    const job = {
      kind, bytes: bytes ?? prev?.bytes, geojson: geojson ?? prev?.geojson, read, options,
    };
    imports.set(jobId, job);
    if (read.needsColumns) return { needsColumns: true, csv: read.csv };
    if (read.needsCrs) {
      return {
        needsCrs: true, looksProjected: read.looksProjected, total: read.features.length, crs: read.crs, csv: read.csv ?? null, shapefiles: read.shapefiles ?? null, prjDeclared: read.prjDeclared ?? null,
      };
    }
    progress(0.3, 'Reprojetando e conferindo geometrias');
    job.normalized = normalizeFeatures(read.features, { crs: read.crs, onProgress: (p) => progress(0.3 + p * 0.65, 'Reprojetando e conferindo geometrias') });
    // As feições brutas não são mais necessárias (uma troca de referencial relê os bytes).
    read.features = null;
    return previewOf(job);
  },

  'import:commit': async ({
    jobId, layerId, version, keepFields, appendTo,
  }, progress) => {
    const job = imports.get(jobId);
    if (!job?.normalized) throw new Error('Importação expirada. Selecione o arquivo novamente.');
    const keep = keepFields ? new Set(keepFields) : null;
    let features = job.normalized.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: keep ? Object.fromEntries(Object.entries(f.properties).filter(([k]) => keep.has(k))) : f.properties,
    }));
    if (appendTo != null) {
      progress(0.05, 'Lendo a versão atual');
      const previous = await readFeatures(layerId, appendTo);
      features = previous.concat(features);
    }
    progress(0.1, 'Gravando no banco local');
    await writeFeatures(layerId, version, features, (p) => progress(0.1 + p * 0.6, 'Gravando no banco local'));
    progress(0.75, 'Montando o índice de tiles');
    const entry = { features, index: buildIndex(features), boxes: featureBoxes(features) };
    opened.set(keyOf(layerId, version), entry);
    imports.delete(jobId);
    progress(1, 'Concluído');
    return { ...describeFeatures(features), attributes: inventoryAttributes(features) };
  },

  'import:discard': async ({ jobId }) => { imports.delete(jobId); return true; },

  'layer:open': async ({ layerId, version }, progress) => {
    const e = await ensureOpen(layerId, version, (p) => progress(p * 0.5, 'Lendo do banco local'));
    return { count: e.features.length };
  },

  'layer:close': async ({ layerId }) => {
    [...opened.keys()].filter((k) => k.startsWith(`${layerId}@`)).forEach((k) => opened.delete(k));
    [...filtered.keys()].filter((k) => k.startsWith(`${layerId}@`)).forEach((k) => filtered.delete(k));
    return true;
  },

  'layer:filter': async ({
    layerId, version, regionKey, polygon,
  }) => {
    const base = await ensureOpen(layerId, version);
    const k = `${keyOf(layerId, version)}#${regionKey}`;
    if (!filtered.has(k)) {
      const idx = filterInside(base.features, base.boxes, polygon);
      const features = idx.map((i) => base.features[i]);
      filtered.set(k, { features, index: buildIndex(features), boxes: featureBoxes(features) });
    }
    return { count: filtered.get(k).features.length, total: base.features.length };
  },

  tile: async ({
    layerId, version, regionKey, z, x, y, fields,
  }) => {
    await ensureOpen(layerId, version);
    const t = target(layerId, version, regionKey);
    if (!t) return { tile: null };
    const tile = packTile(t.index, t.features, z, x, y, { fields });
    return { tile, transfer: [tile.types.buffer, tile.fids.buffer, tile.featPart.buffer, tile.parts.buffer, tile.coords.buffer] };
  },

  hit: async ({
    layerId, version, regionKey, lng, lat, zoom,
  }) => {
    await ensureOpen(layerId, version);
    const t = target(layerId, version, regionKey);
    if (!t) return null;
    return hitTest(t.index, t.features, { lng, lat, zoom });
  },

  summary: async ({ layers, polygon }) => {
    const out = [];
    for (const { layerId, version } of layers) {
      // eslint-disable-next-line no-await-in-loop
      const e = await ensureOpen(layerId, version);
      out.push({ layerId, ...summarizeInside(e.features, e.boxes, polygon) });
    }
    return out;
  },

  fieldStats: async ({ layerId, version, field }) => {
    const e = await ensureOpen(layerId, version);
    return fieldStats(e.features, field);
  },
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  const handler = handlers[type];
  if (!handler) {
    post(id, 'error', { message: `Operação desconhecida: ${type}` });
    return;
  }
  const progress = (value, stage) => post(id, 'progress', { value, stage });
  try {
    const result = await handler(payload ?? {}, progress);
    const transfer = result?.transfer;
    if (transfer) delete result.transfer;
    post(id, 'result', { result }, transfer);
  } catch (err) {
    post(id, 'error', { message: err?.message ?? String(err) });
  }
};
