/**
 * Comparação dos pontos do CSV com o cadastro de pontos prioritários.
 *
 * Regra (parâmetros em PRIORITY_MATCH, config.js — parâmetros de teste):
 *  - A distância é calculada (Haversine), nunca por igualdade de texto ou de
 *    números decimais.
 *  - CONFIRMADA: o código da UC do cadastro coincide com a coluna de
 *    identificador do CSV E o ponto está dentro da tolerância.
 *  - POSSÍVEL: ponto do CSV dentro da tolerância, sem identificador que
 *    confirme. Proximidade sozinha nunca confirma a mesma unidade consumidora.
 *  - REVISÃO: ambiguidades e divergências — um ponto do CSV perto de mais de
 *    um cadastro; identificador coincidente, mas fora da tolerância; ponto
 *    confirmado por identificador para outro cadastro.
 *  - SEM CORRESPONDÊNCIA IDENTIFICADA: ponto do CSV que não se associa a
 *    nenhum cadastro pelos critérios acima. Isso NÃO prova que não há cliente
 *    prioritário afetado.
 *
 * Se o referencial do CSV não for comparável (WGS84/SIRGAS 2000 em graus) ou
 * a tolerância for inválida, a comparação não é executada.
 */
import { haversineMeters, isValidCoordinate, RECORD_STATUS } from './priorityRecords.js';

export const MATCH_STATUS = {
  confirmed: 'confirmed',
  possible: 'possible',
  review: 'review',
};

export const MATCH_LABEL = {
  confirmed: 'Correspondência confirmada',
  possible: 'Possível correspondência',
  review: 'Exige revisão',
};

export const COMPARABLE_CRS = ['EPSG:4326', 'EPSG:4674'];

const norm = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const round1 = (n) => Math.round(n * 10) / 10;
const METERS_PER_DEG_LAT = 111320;

/** Rótulo do ponto do CSV para exibição (sem coordenadas). */
export const pointLabel = (p) => [p.id ?? null, p.line != null ? `linha ${p.line}` : null].filter(Boolean).join(' · ') || p.key;

/**
 * @param {{
 *   points: object[],            pontos válidos do resultado (key, id, line, lat, lng, client, unitId…)
 *   invalidCount?: number,       registros do CSV com coordenadas inválidas (não comparados)
 *   crs?: string|null,           referencial declarado do CSV (null = demonstração)
 *   records: object[],           cadastro prioritário
 *   toleranceMeters: number,
 *   sharedIdField?: string,      campo do ponto comparado ao código da UC
 *   sharedIdMapped?: boolean,    se a coluna existe no CSV
 * }} input
 */
export function matchPriorityPoints({
  points = [], invalidCount = 0, crs = null, records = [], toleranceMeters,
  sharedIdField = 'client', sharedIdMapped = false,
}) {
  const active = records.filter((r) => r.status === RECORD_STATUS.active);
  const base = {
    blocked: false, reason: null, toleranceMeters, analyzed: 0, notCompared: invalidCount,
    activeRecords: active.length, inactiveRecords: records.length - active.length, skippedRecords: [],
    alerts: [], counts: { confirmed: 0, possible: 0, review: 0, unmatchedPoints: 0 }, involvedPointKeys: [], warnings: [],
  };

  if (crs != null && !COMPARABLE_CRS.includes(crs)) {
    return { ...base, blocked: true, reason: 'O referencial do CSV não é WGS84 nem SIRGAS 2000 em graus decimais. A comparação com o cadastro prioritário não foi executada.' };
  }
  if (!(Number.isFinite(toleranceMeters) && toleranceMeters > 0)) {
    return { ...base, blocked: true, reason: 'Tolerância inválida. Informe um valor em metros maior que zero.' };
  }

  const validPoints = points.filter((p) => isValidCoordinate(p.lat, p.lng));
  const comparable = active.filter((r) => isValidCoordinate(r.lat, r.lng));
  const skippedRecords = active.filter((r) => !isValidCoordinate(r.lat, r.lng)).map((r) => r.id);
  const useId = sharedIdMapped && !!sharedIdField;

  // 1. Candidatos por cadastro (distância dentro da tolerância ou identificador coincidente).
  const candidatesByRecord = new Map();
  const geoRecordsByPoint = new Map(); // ponto → cadastros dentro da tolerância
  const idConfirmedByPoint = new Map(); // ponto → cadastros confirmados por identificador
  comparable.forEach((r) => {
    const uc = useId ? norm(r.ucCode) : '';
    const dLat = toleranceMeters / METERS_PER_DEG_LAT;
    const dLng = toleranceMeters / (METERS_PER_DEG_LAT * Math.max(0.01, Math.cos((r.lat * Math.PI) / 180)));
    const list = [];
    validPoints.forEach((p) => {
      const idMatch = !!uc && norm(p[sharedIdField]) === uc;
      const nearBox = Math.abs(p.lat - r.lat) <= dLat && Math.abs(p.lng - r.lng) <= dLng;
      if (!idMatch && !nearBox) return;
      const d = haversineMeters(r.lat, r.lng, p.lat, p.lng);
      const within = d <= toleranceMeters;
      if (!idMatch && !within) return;
      list.push({ point: p, distance: d, within, idMatch });
      if (within) {
        if (!geoRecordsByPoint.has(p.key)) geoRecordsByPoint.set(p.key, new Set());
        geoRecordsByPoint.get(p.key).add(r.id);
        if (idMatch) {
          if (!idConfirmedByPoint.has(p.key)) idConfirmedByPoint.set(p.key, new Set());
          idConfirmedByPoint.get(p.key).add(r.id);
        }
      }
    });
    if (list.length) candidatesByRecord.set(r.id, list.sort((a, b) => a.distance - b.distance));
  });

  // 2. Classificação de cada cadastro com candidatos.
  const alerts = [];
  comparable.forEach((r) => {
    const list = candidatesByRecord.get(r.id);
    if (!list) return;
    const idWithin = list.filter((c) => c.idMatch && c.within);
    const idFar = list.filter((c) => c.idMatch && !c.within);
    const geo = list.filter((c) => c.within);
    const reasons = [];
    let status;
    let primary;
    let evidence;

    if (idWithin.length) {
      status = MATCH_STATUS.confirmed;
      [primary] = idWithin;
      evidence = 'identificador + distância';
      reasons.push(`Código da UC coincide com o CSV e o ponto está a ${round1(primary.distance)} m (tolerância: ${toleranceMeters} m).`);
      if (idWithin.length > 1) reasons.push(`${idWithin.length} pontos do CSV com o mesmo código dentro da tolerância.`);
    } else if (idFar.length) {
      status = MATCH_STATUS.review;
      [primary] = idFar;
      evidence = 'identificador (fora da tolerância)';
      reasons.push(`Código da UC coincide, mas o ponto do CSV está a ${round1(primary.distance)} m, acima da tolerância de ${toleranceMeters} m. Confira as coordenadas do cadastro e do CSV.`);
      if (geo.length) reasons.push(`Há também ${geo.length} ponto(s) do CSV próximo(s) sem o mesmo código.`);
    } else {
      [primary] = geo;
      evidence = 'distância';
      const shared = geo.filter((c) => (geoRecordsByPoint.get(c.point.key)?.size ?? 0) > 1);
      const claimed = geo.filter((c) => (idConfirmedByPoint.get(c.point.key)?.size ?? 0) > 0);
      if (claimed.length) {
        status = MATCH_STATUS.review;
        const others = [...idConfirmedByPoint.get(claimed[0].point.key)].join(', ');
        reasons.push(`O ponto ${pointLabel(claimed[0].point)} foi confirmado por identificador para ${others}. Confira se este cadastro também é afetado.`);
      } else if (shared.length) {
        status = MATCH_STATUS.review;
        const others = [...geoRecordsByPoint.get(shared[0].point.key)].filter((id) => id !== r.id);
        reasons.push(`Ambiguidade: o ponto ${pointLabel(shared[0].point)} está dentro da tolerância de mais de um cadastro (${[r.id, ...others].join(', ')}).`);
      } else {
        status = MATCH_STATUS.possible;
        reasons.push(`Ponto do CSV a ${round1(primary.distance)} m (tolerância: ${toleranceMeters} m). Proximidade não confirma que é a mesma unidade consumidora.`);
      }
      if (!useId) reasons.push('Sem coluna de identificador compartilhado no CSV: nenhuma correspondência pode ser confirmada automaticamente.');
      else if (!norm(r.ucCode)) reasons.push('Cadastro sem código da UC: a correspondência não pode ser confirmada por identificador.');
      if (geo.length > 1) reasons.push(`${geo.length} pontos do CSV dentro da tolerância.`);
    }

    alerts.push({
      recordId: r.id,
      category: r.category,
      matchStatus: status,
      evidence,
      reasons,
      distanceMeters: round1(primary.distance),
      primaryPointKey: primary.point.key,
      primaryPointLabel: pointLabel(primary.point),
      primaryUnitId: primary.point.unitId ?? null,
      pointKeys: list.map((c) => c.point.key),
      points: list.map((c) => ({
        key: c.point.key, label: pointLabel(c.point), distanceMeters: round1(c.distance), within: c.within, idMatch: c.idMatch,
      })),
    });
  });

  const SEVERITY = { review: 0, confirmed: 1, possible: 2 };
  alerts.sort((a, b) => a.category.localeCompare(b.category)
    || SEVERITY[a.matchStatus] - SEVERITY[b.matchStatus] || a.distanceMeters - b.distanceMeters);

  const involved = new Set(alerts.flatMap((a) => a.pointKeys));
  const counts = {
    confirmed: alerts.filter((a) => a.matchStatus === MATCH_STATUS.confirmed).length,
    possible: alerts.filter((a) => a.matchStatus === MATCH_STATUS.possible).length,
    review: alerts.filter((a) => a.matchStatus === MATCH_STATUS.review).length,
    unmatchedPoints: validPoints.filter((p) => !involved.has(p.key)).length,
  };

  const warnings = [];
  if (invalidCount > 0) warnings.push(`${invalidCount} registro(s) do CSV com coordenadas inválidas ou ausentes não foram comparados. Um ponto prioritário pode estar entre eles.`);
  if (points.length > validPoints.length) warnings.push(`${points.length - validPoints.length} ponto(s) sem coordenada utilizável não foram comparados.`);
  if (skippedRecords.length) warnings.push(`Cadastro(s) com coordenadas inválidas não comparados: ${skippedRecords.join(', ')}.`);
  if (!useId) warnings.push('O CSV não tem coluna de identificador compartilhado (cliente/UC): os resultados são apenas por proximidade e precisam de conferência.');
  if (!active.length) warnings.push('Nenhum cadastro prioritário ativo: não há o que comparar.');

  return {
    ...base,
    analyzed: validPoints.length,
    skippedRecords,
    alerts,
    counts,
    involvedPointKeys: [...involved],
    warnings,
  };
}
