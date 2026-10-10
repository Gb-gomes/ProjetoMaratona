/**
 * Cruzamento espacial real (ponto no polígono) entre os pontos validados
 * do CSV e a camada territorial carregada. Executado no navegador.
 *
 * Regras (documentadas em docs/CAMADA_TERRITORIAL.md):
 *  1. Um ponto é ASSOCIADO quando está no interior de exatamente uma
 *     unidade e não toca o limite de nenhuma outra.
 *  2. Um ponto é SEM CORRESPONDÊNCIA quando não está em nenhuma unidade.
 *     Nunca é atribuído à unidade mais próxima.
 *  3. Um ponto é AMBÍGUO quando está sobre o limite de alguma unidade
 *     (inclusive o limite externo da área carregada ou de um recorte
 *     interno) ou dentro de mais de uma unidade (sobreposição). Pontos
 *     ambíguos não entram em nenhuma contagem por unidade e exigem revisão.
 *
 * A verificação usa @turf/boolean-point-in-polygon, que trata Polygon,
 * MultiPolygon e anéis internos (buracos). Para cada candidato, o teste
 * é feito com e sem o limite: incluso só com limite ⇒ ponto sobre o limite.
 */
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import { featureBounds } from './geo.js';

export const POINT_STATUS = {
  matched: 'matched',
  unmatched: 'unmatched',
  ambiguous: 'ambiguous',
};

const inBbox = ([x, y], [minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY;

/**
 * Localiza um ponto na camada.
 * @returns {{status:string, unitId:string|null, candidates:string[], reason:string|null}}
 */
export function locatePoint(lng, lat, features) {
  const pt = turfPoint([lng, lat]);
  const interior = [];
  const boundary = [];
  features.forEach((f) => {
    if (f.bbox && !inBbox([lng, lat], f.bbox)) return;
    if (!booleanPointInPolygon(pt, f.geometry)) return;
    if (booleanPointInPolygon(pt, f.geometry, { ignoreBoundary: true })) interior.push(f.properties.id);
    else boundary.push(f.properties.id);
  });

  if (interior.length === 1 && boundary.length === 0) {
    return { status: POINT_STATUS.matched, unitId: interior[0], candidates: interior, reason: null };
  }
  if (interior.length === 0 && boundary.length === 0) {
    return { status: POINT_STATUS.unmatched, unitId: null, candidates: [], reason: 'Fora de todas as unidades da camada carregada.' };
  }
  const candidates = [...interior, ...boundary];
  const reason = boundary.length
    ? `Sobre o limite de ${boundary.length} unidade(s)${interior.length ? ` e no interior de ${interior.length}` : ''}.`
    : `No interior de ${interior.length} unidades sobrepostas.`;
  return { status: POINT_STATUS.ambiguous, unitId: null, candidates, reason };
}

/** Conta valores distintos não vazios; null quando a coluna não foi mapeada. */
function countUnique(records, key, mapped) {
  if (!mapped) return null;
  return new Set(records.map((r) => r[key]).filter((v) => v != null && v !== '')).size;
}

/**
 * Executa o cruzamento.
 *
 * @param {object} validation resultado de validateRecords()
 * @param {{features: object[]}} layer camada normalizada por validateLayer()
 * @param {{mapping?: object, source?: string}} [options]
 */
export function spatialJoin(validation, layer, { mapping = {}, source = 'real' } = {}) {
  if (!layer?.features?.length) throw new Error('Nenhuma camada territorial carregada.');
  const validRecords = (validation?.records ?? []).filter((r) => r.status === 'valid');
  if (!validRecords.length) throw new Error('Nenhum registro válido para processar.');

  const byId = new Map(layer.features.map((f) => [f.properties.id, f]));
  const groups = new Map();

  const points = validRecords.map((r, i) => {
    const loc = locatePoint(r.lng, r.lat, layer.features);
    const key = r.id ?? `L${r.line}`;
    const p = {
      key,
      id: r.id,
      line: r.line,
      lat: r.lat,
      lng: r.lng,
      client: r.client,
      equipment: r.equipment,
      property: r.property,
      warnings: r.issues.map((x) => x.message),
      seq: i,
      ...loc,
    };
    if (loc.status === POINT_STATUS.matched) {
      if (!groups.has(loc.unitId)) groups.set(loc.unitId, []);
      groups.get(loc.unitId).push(key);
    }
    return p;
  });

  const matched = points.filter((p) => p.status === POINT_STATUS.matched).length;
  const units = [...groups.entries()]
    .map(([id, pointKeys]) => {
      const f = byId.get(id);
      const {
        code, name, label, context = [], fallbackName = null,
      } = f.properties;
      return {
        id,
        code,
        name,
        label,
        context,
        fallbackName,
        count: pointKeys.length,
        pct: Math.round((pointKeys.length / matched) * 1000) / 10,
        pointIds: pointKeys,
        bounds: featureBounds(f),
      };
    })
    // Ordem estável: mais pontos primeiro; empate pelo código oficial.
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .map((u, i) => ({ ...u, order: i + 1 }));

  const unitSum = units.reduce((s, u) => s + u.count, 0);

  return {
    source,
    imported: validation.total,
    valid: validRecords.length,
    invalid: validation.total - validRecords.length,
    warnings: validation.warnings ?? 0,
    matched,
    unmatched: points.filter((p) => p.status === POINT_STATUS.unmatched).length,
    ambiguous: points.filter((p) => p.status === POINT_STATUS.ambiguous).length,
    points,
    units,
    unique: {
      clients: countUnique(validRecords, 'client', mapping.client != null),
      equipments: countUnique(validRecords, 'equipment', mapping.equipment != null),
      properties: countUnique(validRecords, 'property', mapping.property != null),
    },
    checks: {
      unitSumEqualsMatched: unitSum === matched,
      statusSumEqualsValid: matched + points.filter((p) => p.status !== POINT_STATUS.matched).length === validRecords.length,
    },
    processedAt: new Date().toISOString(),
  };
}
