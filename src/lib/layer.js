/**
 * Carregamento e validação da camada territorial (GeoJSON).
 *
 * A camada é lida de um arquivo local servido pela própria aplicação
 * (public/data/ibge/...). Os atributos oficiais são preservados em
 * `official`; os campos de id, código e nome são lidos conforme a
 * configuração, sem renomear nem "embelezar" valores.
 */
import { geometryBbox, bboxToBounds } from './geo.js';

/**
 * Valida a estrutura de uma FeatureCollection e devolve a camada
 * normalizada para uso interno.
 *
 * @param {object} geojson
 * @param {{idField:string, codeField?:string, nameField?:string|null}} fields
 * @returns {{ok:boolean, errors:string[], warnings:string[], layer:object|null, stats:object}}
 */
export function validateLayer(geojson, fields) {
  const errors = [];
  const warnings = [];
  const stats = { features: 0, polygons: 0, multiPolygons: 0, skipped: 0, attributes: [] };

  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { ok: false, errors: ['O arquivo não é uma FeatureCollection GeoJSON.'], warnings, layer: null, stats };
  }
  if (!fields?.idField) {
    return { ok: false, errors: ['Campo identificador (idField) não configurado.'], warnings, layer: null, stats };
  }

  const crsName = geojson.crs?.properties?.name;
  if (crsName && !/(CRS84|4326|4674)/.test(crsName)) {
    errors.push(`Sistema de referência da camada não suportado: ${crsName}. Converta para EPSG:4326.`);
  }

  stats.attributes = Object.keys(geojson.features[0]?.properties ?? {});
  const ids = new Set();
  const features = [];
  let outOfRange = 0;

  geojson.features.forEach((f, i) => {
    stats.features += 1;
    const type = f?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      stats.skipped += 1;
      warnings.push(`Feição ${i + 1}: geometria "${type ?? 'ausente'}" ignorada (esperado Polygon ou MultiPolygon).`);
      return;
    }
    if (type === 'Polygon') stats.polygons += 1;
    else stats.multiPolygons += 1;

    const props = f.properties ?? {};
    const rawId = props[fields.idField];
    if (rawId == null || String(rawId).trim() === '') {
      errors.push(`Feição ${i + 1}: campo identificador "${fields.idField}" vazio.`);
      return;
    }
    const id = String(rawId);
    if (ids.has(id)) {
      errors.push(`Identificador repetido na camada: ${id}.`);
      return;
    }
    ids.add(id);

    const bbox = geometryBbox(f.geometry);
    if (bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) outOfRange += 1;

    const code = fields.codeField ? String(props[fields.codeField] ?? id) : id;
    const name = fields.nameField && props[fields.nameField] != null && String(props[fields.nameField]).trim() !== ''
      ? String(props[fields.nameField])
      : null;

    features.push({
      type: 'Feature',
      geometry: f.geometry,
      bbox,
      properties: {
        id,
        code,
        name,
        label: name ?? code,
        order: features.length,
        official: props,
        context: (fields.contextFields ?? [])
          .map(({ field, label }) => ({ label, value: props[field] == null ? '' : String(props[field]).trim() }))
          .filter((c) => c.value !== ''),
      },
    });
  });

  if (outOfRange) {
    errors.push(`${outOfRange} feição(ões) com coordenadas fora da escala de graus: a camada parece projetada. Converta para EPSG:4326.`);
  }
  if (!features.length && !errors.length) errors.push('A camada não contém polígonos utilizáveis.');

  const ok = errors.length === 0;
  let bounds = null;
  if (ok) {
    const all = features.map((f) => f.bbox);
    bounds = bboxToBounds([
      Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])),
      Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3])),
    ]);
  }
  return {
    ok,
    errors,
    warnings,
    stats,
    layer: ok ? { type: 'FeatureCollection', features, bounds } : null,
  };
}

const isHtml = (response) => (response.headers.get('content-type') ?? '').includes('text/html');

/** Busca o GeoJSON local configurado e valida. Não acessa serviços externos. */
export async function loadLayer(url, fields, { signal } = {}) {
  if (!/^\/(?!\/)/.test(url)) {
    throw new Error('A camada deve ser um arquivo local da aplicação (caminho iniciado por "/").');
  }
  const response = await fetch(url, { signal, cache: 'no-cache' });
  // O servidor de desenvolvimento devolve index.html (HTML) para arquivos ausentes.
  if (!response.ok || isHtml(response)) {
    throw new Error(`Arquivo da camada não encontrado: ${url}. Veja docs/CAMADA_TERRITORIAL.md.`);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`O arquivo ${url} não é um JSON válido.`);
  }
  return validateLayer(json, fields);
}

/** Carrega a tabela opcional de correspondência de nomes (código → nome validado). */
export async function loadNameCorrespondence(url, { signal } = {}) {
  if (!url) return {};
  const response = await fetch(url, { signal, cache: 'no-cache' });
  if (response.status === 404 || isHtml(response)) return {};
  if (!response.ok) throw new Error(`Tabela de correspondência indisponível (HTTP ${response.status}).`);
  const json = await response.json();
  return normalizeCorrespondence(json);
}

/**
 * Aceita somente entradas com nome, responsável e data de validação.
 * Formato: { "entries": [{ "code": "...", "name": "...", "validatedBy": "...", "validatedOn": "AAAA-MM-DD", "source": "..." }] }
 */
export function normalizeCorrespondence(json) {
  const out = {};
  (json?.entries ?? []).forEach((e) => {
    if (e?.code && e?.name?.trim() && e?.validatedBy?.trim() && e?.validatedOn) {
      out[String(e.code)] = {
        name: e.name.trim(), validatedBy: e.validatedBy, validatedOn: e.validatedOn, source: e.source ?? null,
      };
    }
  });
  return out;
}
