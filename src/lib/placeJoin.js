/**
 * Cruzamento dos pontos pela malha de LUGARES (município → distrito →
 * comunidade), sem depender dos setores censitários.
 *
 * Antes, o cruzamento passava primeiro pela malha de setores do município
 * piloto (Cataguases): um ponto em qualquer outro município da área da
 * Energisa ficava "sem correspondência", mesmo dentro de uma comunidade.
 * Agora:
 *  - associado     = o ponto está num dos municípios carregados (os da área);
 *  - sem correspondência = fora de todos eles (fora da área de atendimento).
 * O nome do lugar (comunidade, área urbana, sede de distrito) é dado depois
 * por placeRegions.groupByPlace, como antes.
 *
 * Os setores censitários continuam OPCIONAIS: quando a malha está carregada e
 * contém o ponto, ele guarda o setor (contorno da "área urbana" no mapa e
 * código na auditoria). Sem setor, a unidade de partida é o município.
 *
 * Mesmo formato de spatialJoin (lib/spatialJoin.js).
 */
import { featureBounds } from './geo.js';
import { locatePoint, POINT_STATUS } from './spatialJoin.js';

const MUN_PREFIX = 'mun:';

function pointsBounds(points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

function countUnique(records, key, mapped) {
  if (!mapped) return null;
  return new Set(records.map((r) => r[key]).filter((v) => v != null && v !== '')).size;
}

/**
 * @param {object} validation resultado de validateRecords()
 * @param {{ locator, sectorLayer?: {features: object[]}, mapping?: object, source?: string }} options
 */
export function placeJoin(validation, {
  locator, sectorLayer = null, mapping = {}, source = 'real',
} = {}) {
  if (!locator) throw new Error('A malha de municípios e comunidades ainda não foi carregada.');
  const validRecords = (validation?.records ?? []).filter((r) => r.status === 'valid');
  if (!validRecords.length) throw new Error('Nenhum registro válido para processar.');

  const sectors = sectorLayer?.features ?? [];
  const sectorById = new Map(sectors.map((f) => [f.properties.id, f]));
  const groups = new Map();
  const munInfo = new Map();

  const points = validRecords.map((r, i) => {
    const place = locator.locate([r.lng, r.lat]);
    const key = r.id ?? `L${r.line}`;
    const base = {
      key,
      id: r.id,
      line: r.line,
      lat: r.lat,
      lng: r.lng,
      client: r.client,
      equipment: r.equipment,
      property: r.property,
      car: r.car ?? null,
      farm: r.farm ?? null,
      coordOrigin: r.coordOrigin ?? 'arquivo',
      manual: !!r.manual,
      warnings: r.issues.map((x) => x.message),
      seq: i,
      place,
      candidates: [],
    };
    if (!place?.municipio) {
      return {
        ...base, status: POINT_STATUS.unmatched, unitId: null, reason: 'Fora dos municípios da área de atendimento carregados.',
      };
    }
    // Setor censitário (opcional): só quando a malha contém o ponto sem ambiguidade.
    const sec = sectors.length ? locatePoint(r.lng, r.lat, sectors) : null;
    let unitId;
    if (sec?.status === POINT_STATUS.matched) unitId = sec.unitId;
    else {
      unitId = `${MUN_PREFIX}${place.municipio.cod}`;
      munInfo.set(unitId, place.municipio);
    }
    if (!groups.has(unitId)) groups.set(unitId, []);
    groups.get(unitId).push(base);
    return { ...base, status: POINT_STATUS.matched, unitId };
  });

  const matched = points.filter((p) => p.status === POINT_STATUS.matched).length;
  const units = [...groups.entries()]
    .map(([id, pts]) => {
      const pointIds = pts.map((p) => p.key);
      const common = {
        id, count: pts.length, pct: Math.round((pts.length / matched) * 1000) / 10, pointIds,
      };
      const f = sectorById.get(id);
      if (f) {
        const {
          code, name, label, context = [], fallbackName = null,
        } = f.properties;
        return {
          ...common, code, name, label, context, fallbackName, bounds: featureBounds(f),
        };
      }
      const mun = munInfo.get(id);
      const munLabel = `${mun.nome}${mun.uf ? `/${mun.uf}` : ''}`;
      return {
        ...common,
        code: mun.cod,
        name: null,
        label: munLabel,
        context: [{ label: 'Município', value: munLabel }],
        fallbackName: `Zona rural de ${mun.nome}`,
        bounds: pointsBounds(pts),
      };
    })
    .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)))
    .map((u, i) => ({ ...u, order: i + 1 }));

  const unitSum = units.reduce((s, u) => s + u.count, 0);
  const unmatched = points.filter((p) => p.status === POINT_STATUS.unmatched).length;
  return {
    source,
    joinedBy: 'lugar',
    imported: validation.total,
    valid: validRecords.length,
    invalid: validation.total - validRecords.length,
    warnings: validation.warnings ?? 0,
    fromFarm: validation.fromFarm ?? 0,
    matched,
    unmatched,
    ambiguous: 0,
    points,
    units,
    unique: {
      clients: countUnique(validRecords, 'client', mapping.client != null),
      equipments: countUnique(validRecords, 'equipment', mapping.equipment != null),
      properties: countUnique(validRecords, 'property', mapping.property != null || (validation.fromFarm ?? 0) > 0),
    },
    checks: {
      unitSumEqualsMatched: unitSum === matched,
      statusSumEqualsValid: matched + unmatched === validRecords.length,
    },
    processedAt: new Date().toISOString(),
  };
}
