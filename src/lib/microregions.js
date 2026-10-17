/**
 * Microrregiões rurais (comunidades): áreas aproximadas com nome, usadas para dizer em qual
 * microrregião cai cada ponto (lat/long) e como unidade da carta para as rádios.
 *
 * Origem: scripts/comunidades/exportar_microrregioes.py (repositório de dados do time).
 *  - nome: IBGE CNEFE 2022 (localidade dos endereços rurais; Palmeiras/Leopoldina vem do nome das estradas);
 *  - área: zona rural (setores IBGE 2022) repartida pelos endereços do Censo; NÃO é limite oficial.
 *
 * As microrregiões entram como SUB-REGIÕES da organização (customRegions.js), com a tag
 * MICROREGION_TAG: a Energisa ajusta área e nome no painel "Sub-regiões" e o histórico fica guardado.
 * A carga inicial é idempotente: uma microrregião já carregada (mesmo excluída depois) não volta.
 *
 * Módulo puro (sem React nem armazenamento).
 */
import {
  createRegion, siblingsOf, isActive, REGION_COLORS,
} from './customRegions.js';
import {
  differenceGeometries, unionGeometries, areaM2, geometryBboxAny, bboxIntersects, pointInGeometry,
} from './geoOps.js';
import { geometryBbox, bboxToBounds } from './geo.js';

export const MICROREGION_TAG = 'microrregião';
export const MICROREGION_CODE_PREFIX = 'MR-';
/** Sobra menor que isto, depois de descontar as sub-regiões vizinhas, não vira microrregião. */
const MIN_AREA_M2 = 1000;

export const isMicroregion = (r) => (r.tags ?? []).includes(MICROREGION_TAG);
/** Chave da carga inicial: município + código da microrregião. */
const seedKey = (ibgeParentCode, internalCode) => `${ibgeParentCode}|${internalCode}`;

/**
 * Rascunhos de sub-região a partir do GeoJSON exportado (uma feição por microrregião).
 * @param gj FeatureCollection com ID, COMUNIDADE, NOME_NA_FONTE, ENDERECOS_IBGE, CONFIANCA, DISTRITOS, CONTORNO
 */
export function microregionDrafts(gj, { municipalityCode, municipalityName, sourceFile }) {
  return (gj?.features ?? [])
    .filter((f) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f, i) => {
      const p = f.properties ?? {};
      const lowConfidence = p.CONFIANCA && p.CONFIANCA !== 'boa';
      const description = [
        'Microrregião rural (área aproximada).',
        p.NOME_NA_FONTE && `Nome no Censo 2022: ${p.NOME_NA_FONTE}${p.ENDERECOS_IBGE != null ? ` (${p.ENDERECOS_IBGE} endereços)` : ''}.`,
        p.DISTRITOS && p.DISTRITOS !== '-' && `Distrito(s): ${p.DISTRITOS}.`,
        p.CONFIANCA && `Confiança: ${p.CONFIANCA}.`,
        p.CONTORNO && `Contorno: ${p.CONTORNO}.`,
      ].filter(Boolean).join(' ');
      return {
        name: String(p.COMUNIDADE ?? p.ID ?? `Microrregião ${i + 1}`),
        description: description.slice(0, 1000),
        color: REGION_COLORS[i % REGION_COLORS.length],
        internalCode: `${MICROREGION_CODE_PREFIX}${p.ID ?? i + 1}`.slice(0, 40),
        tags: [MICROREGION_TAG, municipalityName, ...(lowConfidence ? ['conferir'] : [])].filter(Boolean),
        geometry: f.geometry,
        ibgeParentCode: municipalityCode,
        parentCustomRegionId: null,
        creationMethod: 'imported',
        sourceFile,
      };
    });
}

/** Rascunhos ainda não carregados (os já carregados, mesmo excluídos, ficam de fora). */
export function pendingDrafts(regions, drafts) {
  const known = new Set(regions.filter(isMicroregion).map((r) => seedKey(r.ibgeParentCode, r.internalCode)));
  return drafts.filter((d) => !known.has(seedKey(d.ibgeParentCode, d.internalCode)));
}

/**
 * Cria UMA microrregião como sub-região. Antes, desconta a área das sub-regiões irmãs que já
 * existem (lascas de arredondamento entre microrregiões vizinhas ou áreas desenhadas pela
 * organização): a regra de não sobreposição continua valendo.
 * @returns {{ regions, region }} ou lança erro com o motivo.
 */
export function createMicroregion(regions, draft, { orgId, parentGeometry, rules }, opts) {
  const bbox = geometryBboxAny(draft.geometry);
  const near = siblingsOf(regions, { orgId, ibgeParentCode: draft.ibgeParentCode, parentCustomRegionId: null })
    .filter((s) => s.geometry && bboxIntersects(bbox, geometryBboxAny(s.geometry)));
  let geometry = draft.geometry;
  if (near.length) geometry = differenceGeometries(geometry, unionGeometries(near.map((s) => s.geometry)));
  if (!geometry || areaM2(geometry) < MIN_AREA_M2) throw new Error('A área já está coberta por outras sub-regiões.');
  const out = createRegion(regions, { ...draft, geometry }, {
    regions, orgId, parentGeometry, rules,
  }, opts);
  return { regions: out.regions, region: out.region };
}

/**
 * Camada de unidades no formato de layer.js (validateLayer), para o cruzamento dos pontos
 * (spatialJoin) e para a carta. O nome falado é o nome da sub-região.
 */
export function microregionLayer(regions, { municipalityName = (c) => c } = {}) {
  const micro = regions.filter((r) => isActive(r) && isMicroregion(r) && r.geometry);
  if (!micro.length) return null;
  const sorted = [...micro].sort((a, b) => municipalityName(a.ibgeParentCode).localeCompare(municipalityName(b.ibgeParentCode))
    || a.name.localeCompare(b.name));
  const features = sorted.map((r, i) => {
    const bbox = geometryBbox(r.geometry);
    return {
      type: 'Feature',
      geometry: r.geometry,
      bbox,
      properties: {
        id: r.id,
        code: r.internalCode ?? r.id,
        name: r.name,
        label: r.name,
        order: i,
        official: { regionId: r.id, ibgeParentCode: r.ibgeParentCode, areaKm2: r.areaKm2 },
        fallbackName: r.name,
        context: [{ label: 'Município', value: municipalityName(r.ibgeParentCode) }],
      },
    };
  });
  const all = features.map((f) => f.bbox);
  const bounds = bboxToBounds([
    Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3])),
  ]);
  return { type: 'FeatureCollection', features, bounds };
}

/**
 * Em qual microrregião (e município) está o ponto. Nunca escolhe a mais próxima:
 * fora de todas, devolve lista vazia.
 * @param municipalities [{ code, name, geometry }] (hierarquia do IBGE, nível município)
 */
export function locateMicroregion(lat, lng, regions, municipalities = []) {
  const p = [lng, lat];
  const inside = (g) => {
    const [x0, y0, x1, y1] = geometryBboxAny(g);
    return lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1 && pointInGeometry(p, g);
  };
  const hits = regions.filter((r) => isActive(r) && isMicroregion(r) && r.geometry && inside(r.geometry));
  const municipality = municipalities.find((m) => m.geometry && inside(m.geometry)) ?? null;
  return {
    lat, lng, microregions: hits, municipality,
  };
}

/** Lê "lat, long" (ex.: "-21,49 -42,55", "-21.49, -42.55" ou dois campos). */
export function parseLatLng(latText, lngText) {
  let a = String(latText ?? '').trim();
  let b = String(lngText ?? '').trim();
  if (!b) {
    // Tudo num campo só: "-21.49, -42.55", "-21,49 -42,55", "-21,49; -42,55"...
    const parts = a.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
    if (parts.length !== 2) return { error: 'Informe latitude e longitude, ex.: -21,49 -42,55.' };
    [a, b] = parts;
  }
  const lat = Number(a.trim().replace(',', '.'));
  const lng = Number(b.trim().replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'Latitude e longitude devem ser números em graus decimais.' };
  if (lat < -34 || lat > 6 || lng < -74 || lng > -28) {
    return { error: 'Coordenada fora do Brasil. Confira se latitude e longitude não estão invertidas.' };
  }
  return { lat, lng };
}
