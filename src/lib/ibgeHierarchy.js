/**
 * Hierarquia oficial do IBGE (UF → Intermediária → Imediata → Municípios),
 * usada como região-mãe das sub-regiões. Camadas somente leitura.
 */
import { geometryBboxAny, labelPoint } from './geoOps.js';
import { bboxToBounds } from './geo.js';

export const LEVEL_LABEL = {
  uf: 'UF', intermediaria: 'Região Geográfica Intermediária', imediata: 'Região Geográfica Imediata', municipio: 'Município', setor: 'Setor censitário',
};
export const LEVEL_RANK = {
  uf: 1, intermediaria: 2, imediata: 3, municipio: 4,
};

/** Normaliza o GeoJSON da hierarquia. */
export function parseHierarchy(gj) {
  if (gj?.type !== 'FeatureCollection') throw new Error('Arquivo da hierarquia do IBGE inválido.');
  const regions = gj.features.map((f) => {
    const bbox = geometryBboxAny(f.geometry);
    return {
      code: String(f.properties.code),
      name: f.properties.name,
      level: f.properties.level,
      parentCode: f.properties.parentCode ? String(f.properties.parentCode) : null,
      areaKm2Oficial: f.properties.areaKm2Oficial ?? null,
      geometry: f.geometry,
      bbox,
      bounds: bboxToBounds(bbox),
      labelAt: labelPoint(f.geometry),
    };
  });
  const byCode = new Map(regions.map((r) => [r.code, r]));
  const byLevel = {};
  regions.forEach((r) => { (byLevel[r.level] ??= []).push(r); });
  const all = regions.map((r) => r.bbox);
  const bbox = [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))];
  return {
    regions, byCode, byLevel, bounds: bboxToBounds(bbox),
  };
}

export async function loadHierarchy(url, { signal } = {}) {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(`Hierarquia do IBGE não encontrada (${url}). Rode scripts/preparar_hierarquia_ibge.mjs.`);
  }
  return parseHierarchy(await res.json());
}

/** Caminho completo, do topo até a região: "MG › Juiz de Fora › Cataguases". */
export function hierarchyPath(h, code) {
  const out = [];
  let cur = h?.byCode.get(code);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentCode ? h.byCode.get(cur.parentCode) : null;
  }
  return out;
}
