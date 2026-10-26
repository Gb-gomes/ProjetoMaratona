/**
 * Regiões identificadas por MICRORREGIÃO (modo real).
 *
 * O cruzamento espacial continua sendo feito com os setores censitários
 * (lib/spatialJoin.js): é ele que decide se um ponto está associado, sem
 * correspondência ou ambíguo. Depois, cada ponto associado recebe o lugar do
 * serviço de nomes (lib/placeNames.js) e a lista de regiões passa a ter:
 *
 *  - uma região por microrregião (comunidade) com pontos afetados — o ponto
 *    dentro da comunidade ou a até 100 m dela (regra do serviço de nomes);
 *  - pontos fora de qualquer microrregião agrupados pela área do IBGE
 *    ("Área urbana de Cataguases", "Sede do distrito de Sereno"), com o
 *    contorno dos setores censitários onde estão;
 *  - município sem arquivo de comunidades: o setor censitário, como antes.
 *
 * As contagens não mudam: a soma das regiões continua igual ao total de
 * pontos associados (checks.unitSumEqualsMatched).
 */
import { featureBounds, mergeBounds, bboxToBounds } from './geo.js';
import { polygonsOf } from './geoOps.js';

export const PLACE_KIND = {
  community: 'microrregiao', area: 'area_ibge', sector: 'setor', municipality: 'municipio',
};

const byName = (a, b) => (a ?? '').localeCompare(b ?? '', 'pt-BR');
const uniq = (list) => [...new Set(list.filter(Boolean))];

/**
 * Nome para a carta e para o registro: comunidade + distrito ("Palmeiras (distrito de
 * Ribeiro Junqueira)"). Comunidades com o mesmo nome, ou uma comunidade que atravessa a
 * divisa entre distritos, ficam distintas para quem ouve o aviso.
 */
export function districtPhrase(distritos) {
  const names = (distritos ?? []).map((d) => d.nome).filter(Boolean);
  if (!names.length) return null;
  if (names.length === 1) return `distrito de ${names[0]}`;
  return `distritos de ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}
export const withDistrict = (nome, distritos) => {
  const phrase = districtPhrase(distritos);
  return phrase ? `${nome} (${phrase})` : nome;
};

/**
 * Chave de agrupamento de um ponto associado (null = fica no setor).
 * Comunidade é separada por distrito: a parte de uma comunidade em cada distrito vira
 * uma região própria (a mesma comunidade pode atravessar a divisa).
 */
export function placeKeyOf(place) {
  if (!place?.municipio) return null;
  if (place.comunidade) return `com:${place.comunidade.regionId}${place.distrito?.cod ? `@${place.distrito.cod}` : ''}`;
  if (place.local) return `area:${place.municipio.cod}:${place.distrito?.cod ?? place.local}`;
  return null;
}

/**
 * @param {object} placed resultado do cruzamento com `place` em cada ponto (attachPlaces)
 * @param {{ locator, sectorLayer: {features: object[]} }} sources
 * @returns {object} novo resultado (mesmo formato) ou o próprio `placed`, quando
 *   nenhum ponto associado tem microrregião nem área do IBGE.
 *   Extras: grouping = 'place', features (contornos das novas regiões),
 *   sectorUnits (unidades originais) e, em cada ponto, sectorId/sectorCode.
 */
export function groupByPlace(placed, { locator, sectorLayer } = {}) {
  if (!placed || !locator || placed.source === 'demo') return placed;
  const matchedPts = placed.points.filter((p) => p.status === 'matched' && p.unitId);
  if (!matchedPts.some((p) => placeKeyOf(p.place))) return placed;

  const sectorUnits = new Map(placed.units.map((u) => [u.id, u]));
  const sectorFeatures = new Map((sectorLayer?.features ?? []).map((f) => [f.properties.id, f]));

  const groups = new Map();
  const points = placed.points.map((p) => {
    if (p.status !== 'matched' || !p.unitId) return p;
    const sector = sectorUnits.get(p.unitId);
    const key = placeKeyOf(p.place) ?? p.unitId;
    if (!groups.has(key)) groups.set(key, { key, points: [], sectors: new Set() });
    const g = groups.get(key);
    g.points.push(p);
    g.sectors.add(p.unitId);
    return {
      ...p, unitId: key, sectorId: p.unitId, sectorCode: sector?.code ?? null,
    };
  });

  const features = [];
  const sectorCodes = (g) => [...g.sectors].map((id) => sectorUnits.get(id)?.code).filter(Boolean).sort();
  const sectorBounds = (g) => mergeBounds([...g.sectors].map((id) => sectorUnits.get(id)?.bounds).filter(Boolean));

  const units = [...groups.values()].map((g) => {
    const first = g.points[0].place;
    const base = {
      id: g.key,
      count: g.points.length,
      pointIds: g.points.map((p) => p.key),
      sectors: sectorCodes(g),
      fallbackName: null,
    };
    const mun = first?.municipio;
    const munLabel = mun ? `${mun.nome}${mun.uf ? `/${mun.uf}` : ''}` : null;
    const districts = uniq(g.points.map((p) => {
      const d = p.place?.distrito;
      return d ? `${d.nome}${d.sede ? ' (sede)' : ''}` : null;
    }));

    if (g.key.startsWith('com:')) {
      const c = locator.community?.(first.comunidade.regionId);
      const geometry = c?.geometry ?? null;
      const nome = c?.nome ?? first.comunidade.nome;
      const distritos = [...new Map(g.points.filter((p) => p.place?.distrito)
        .map((p) => [p.place.distrito.cod, { cod: p.place.distrito.cod, nome: p.place.distrito.nome, sede: !!p.place.distrito.sede }])).values()];
      if (geometry) features.push({ type: 'Feature', properties: { id: g.key, code: first.comunidade.id, name: nome }, geometry });
      return {
        ...base,
        kind: PLACE_KIND.community,
        code: `${mun?.cod ?? ''}-${first.comunidade.id}`,
        externalCode: first.comunidade.id,
        regionId: first.comunidade.regionId,
        name: null,
        label: nome,
        placeName: nome,
        // Carta e registro: com o distrito.
        speakName: withDistrict(nome, distritos),
        distritos,
        confianca: c?.confianca ?? first.comunidade.confianca,
        nearCount: g.points.filter((p) => p.place?.origem_nome === 'comunidade_proxima').length,
        context: [
          ...(districts.length ? [{ label: districts.length > 1 ? 'Distritos' : 'Distrito', value: districts.join(', ') }] : []),
          ...(munLabel ? [{ label: 'Município', value: munLabel }] : []),
        ],
        municipio: mun ?? null,
        bounds: c?.bbox ? bboxToBounds(c.bbox) : sectorBounds(g),
      };
    }

    if (g.key.startsWith('area:')) {
      // Contorno: os setores censitários onde os pontos estão (não o distrito inteiro).
      const polys = [...g.sectors].flatMap((id) => polygonsOf(sectorFeatures.get(id)?.geometry));
      if (polys.length) features.push({ type: 'Feature', properties: { id: g.key, code: first.distrito?.cod ?? mun?.cod, name: first.local }, geometry: { type: 'MultiPolygon', coordinates: polys } });
      return {
        ...base,
        kind: PLACE_KIND.area,
        code: first.distrito?.cod ?? mun?.cod ?? '',
        name: null,
        label: first.local,
        placeName: first.local,
        context: munLabel ? [{ label: 'Município', value: munLabel }] : [],
        municipio: mun ?? null,
        bounds: polys.length ? featureBounds({ geometry: { type: 'MultiPolygon', coordinates: polys } }) : sectorBounds(g),
      };
    }

    // Município sem arquivo de comunidades: continua o setor censitário (ou o município, sem malha de setores).
    const sector = sectorUnits.get(g.key);
    const kind = g.key.startsWith('mun:') ? PLACE_KIND.municipality : PLACE_KIND.sector;
    return { ...sector, ...base, kind, fallbackName: sector?.fallbackName ?? null };
  });

  const matched = matchedPts.length;
  const ordered = units
    .map((u) => ({ ...u, pct: matched ? Math.round((u.count / matched) * 1000) / 10 : 0 }))
    // Mais pontos primeiro; empate pelo nome.
    .sort((a, b) => b.count - a.count || byName(a.label ?? a.code, b.label ?? b.code))
    .map((u, i) => ({ ...u, order: i + 1 }));

  const unitSum = ordered.reduce((s, u) => s + u.count, 0);
  return {
    ...placed,
    grouping: 'place',
    points,
    units: ordered,
    sectorUnits: placed.units,
    features,
    checks: { ...placed.checks, unitSumEqualsMatched: unitSum === placed.matched },
  };
}
