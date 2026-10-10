/**
 * SIMULAÇÃO DO CRUZAMENTO ESPACIAL (mock).
 *
 * Como o protótipo não tem backend nem acesso à base do IBGE, esta função
 * NÃO consulta nenhuma malha oficial. Ela usa a associação PREDEFINIDA de
 * cada ponto (`demoUnitId`, definida em data/mockData.js) para contar
 * quantos pontos pertencem a cada unidade territorial demonstrativa.
 *
 * Como verificação de consistência, cada associação é conferida com um
 * teste geométrico local (point-in-polygon) contra as geometrias
 * demonstrativas. O resultado aparece no painel como "correspondência
 * geográfica".
 *
 * O modo "Teste com dados reais" usa spatialJoin() (lib/spatialJoin.js).
 * Esta função devolve o mesmo formato de resultado, com source: 'demo'.
 */
import { pointInFeature, featureBounds } from './geo.js';

/**
 * @param {Array} points pontos com `demoUnitId`
 * @param {{features: Array}} territories FeatureCollection demonstrativa
 * @returns {{
 *   total:number, matched:number, unmatched:number, geometryMismatches:number,
 *   units: Array<{id, code, name, label, order, count, pct, pointIds, insideCount, bounds}>
 * }}
 */
export function mockSpatialJoin(points, territories) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('Nenhum ponto disponível para processar.');
  }
  if (!territories?.features?.length) {
    throw new Error('Nenhuma camada territorial carregada.');
  }

  const byId = new Map(territories.features.map((f) => [f.properties.id, f]));
  const groups = new Map();
  let unmatched = 0;

  points.forEach((p) => {
    const feature = byId.get(p.demoUnitId);
    if (!feature) {
      unmatched += 1;
      return;
    }
    if (!groups.has(feature.properties.id)) groups.set(feature.properties.id, { feature, points: [] });
    groups.get(feature.properties.id).points.push(p);
  });

  const total = points.length;
  let geometryMismatches = 0;

  const units = [...groups.values()]
    .map(({ feature, points: pts }) => {
      const insideCount = pts.filter((p) => pointInFeature([p.lng, p.lat], feature)).length;
      geometryMismatches += pts.length - insideCount;
      const { id, code, name, label, order } = feature.properties;
      return {
        id,
        code,
        name,
        label,
        order,
        count: pts.length,
        pct: Math.round((pts.length / total) * 1000) / 10,
        pointIds: pts.map((p) => p.id),
        insideCount,
        bounds: featureBounds(feature),
      };
    })
    .sort((a, b) => a.order - b.order);

  const unitIds = new Set(units.map((u) => u.id));
  return {
    source: 'demo',
    imported: total,
    valid: total,
    invalid: 0,
    warnings: 0,
    total,
    matched: total - unmatched,
    unmatched,
    ambiguous: 0,
    geometryMismatches,
    points: points.map((p) => ({
      key: p.id,
      id: p.id,
      line: null,
      lat: p.lat,
      lng: p.lng,
      property: `${p.propertyType} ${p.propertyName}`,
      status: unitIds.has(p.demoUnitId) ? 'matched' : 'unmatched',
      unitId: unitIds.has(p.demoUnitId) ? p.demoUnitId : null,
      candidates: [],
      reason: null,
      warnings: [],
    })),
    units,
    unique: { clients: null, equipments: null, properties: total },
    checks: { unitSumEqualsMatched: true, statusSumEqualsValid: true },
  };
}
