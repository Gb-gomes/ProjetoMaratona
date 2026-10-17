/**
 * Indicadores derivados do resultado do processamento.
 * KPIs, painel de regiões, mapa e auditoria leem daqui, para que todos
 * mostrem os mesmos números.
 */

export const DEFAULT_POINT_FILTER = { matched: true, unmatched: true, ambiguous: true };

export function summarize(result, selectedIds = []) {
  if (!result) return null;
  const selectedUnits = result.units.filter((u) => selectedIds.includes(u.id));
  const unitSum = result.units.reduce((s, u) => s + u.count, 0);
  return {
    imported: result.imported,
    valid: result.valid,
    invalid: result.invalid,
    warnings: result.warnings ?? 0,
    matched: result.matched,
    unmatched: result.unmatched,
    ambiguous: result.ambiguous,
    unitCount: result.units.length,
    selectedCount: selectedUnits.length,
    selectedPoints: selectedUnits.reduce((s, u) => s + u.count, 0),
    unitSum,
    consistent: unitSum === result.matched
      && result.matched + result.unmatched + result.ambiguous === result.valid
      && result.points.length === result.valid,
  };
}

/** Pontos exibidos no mapa conforme o filtro de status. */
export function pointsForMap(result, filter = DEFAULT_POINT_FILTER) {
  if (!result) return [];
  return result.points.filter((p) => filter[p.status]);
}

/** Linhas da auditoria (CSV) — somente campos operacionais necessários. */
export function auditRows(result, { includeCoordinates = false } = {}) {
  const unitCode = new Map(result.units.map((u) => [u.id, u.code]));
  const unitContext = new Map(result.units.map((u) => [u.id, (u.context ?? []).map((c) => c.value).join(' | ')]));
  // Regiões por microrregião: o código da unidade continua sendo o setor censitário; a região vai à parte.
  const grouped = result.grouping === 'place';
  const sectorContext = grouped ? new Map((result.sectorUnits ?? []).map((u) => [u.id, (u.context ?? []).map((c) => c.value).join(' | ')])) : null;
  const unitName = new Map(result.units.map((u) => [u.id, u.placeName ?? u.code]));
  const header = ['linha', 'id_ponto', 'status', 'codigo_unidade', 'contexto_unidade', 'candidatas', 'motivo', 'alertas'];
  // Localização pelo serviço de nomes (IBGE + comunidades), quando disponível.
  if (grouped) header.splice(5, 0, 'regiao');
  const withPlace = result.points.some((p) => p.place);
  if (withPlace) header.push('municipio', 'distrito', 'comunidade_id', 'comunidade', 'confianca_comunidade', 'origem_nome');
  if (includeCoordinates) header.push('latitude', 'longitude');
  const label = { matched: 'associado', unmatched: 'sem_correspondencia', ambiguous: 'ambiguo' };
  const rows = result.points.map((p) => {
    const row = [
      p.line ?? '', p.id ?? '', label[p.status],
      p.unitId ? (p.sectorCode ?? unitCode.get(p.unitId)) : '',
      p.unitId ? (grouped && p.sectorId ? sectorContext.get(p.sectorId) ?? '' : unitContext.get(p.unitId)) : '',
      p.candidates.join(' '), p.reason ?? '', p.warnings.join(' | '),
    ];
    if (grouped) row.splice(5, 0, p.unitId ? unitName.get(p.unitId) : '');
    if (withPlace) {
      const pl = p.place;
      row.push(pl?.municipio?.nome ?? '', pl?.distrito?.nome ?? '', pl?.comunidade?.id ?? '', pl?.comunidade?.nome ?? pl?.local ?? '', pl?.comunidade?.confianca ?? '', pl?.origem_nome ?? '');
    }
    if (includeCoordinates) row.push(p.lat, p.lng);
    return row;
  });
  return [header, ...rows];
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(';')).join('\r\n')}`;
}

/**
 * Junta a localização (serviço de nomes) a cada ponto do resultado.
 * Não altera o resultado original; devolve o mesmo objeto sem localizador.
 */
export function attachPlaces(result, locator) {
  if (!result || !locator) return result;
  return { ...result, points: result.points.map((p) => ({ ...p, place: locator.locate([p.lng, p.lat]) })) };
}

/**
 * Comunidades de cada unidade: nomes (ordem de pontos, decrescente) e se há
 * pontos fora de qualquer comunidade. Só pontos associados à unidade.
 * @returns {Map<unitId, { names: string[], counts: {name, id, count, confianca}[], uncovered: number }>}
 */
export function communitiesByUnit(placedResult) {
  const out = new Map();
  if (!placedResult) return out;
  const acc = new Map();
  placedResult.points.forEach((p) => {
    if (p.status !== 'matched' || !p.unitId || !p.place) return;
    if (!acc.has(p.unitId)) acc.set(p.unitId, { byName: new Map(), uncovered: 0 });
    const a = acc.get(p.unitId);
    const c = p.place.comunidade;
    if (!c) { a.uncovered += 1; return; }
    const cur = a.byName.get(c.regionId) ?? { name: c.nome, id: c.id, confianca: c.confianca, count: 0 };
    cur.count += 1;
    a.byName.set(c.regionId, cur);
  });
  acc.forEach((a, unitId) => {
    const counts = [...a.byName.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'pt-BR'));
    if (counts.length) out.set(unitId, { names: counts.map((c) => c.name), counts, uncovered: a.uncovered });
  });
  return out;
}

/** Pontos por comunidade (relatórios): [{ chave, nome, detalhe, total }]. */
export function pointsByPlace(placedResult) {
  const m = new Map();
  (placedResult?.points ?? []).forEach((p) => {
    const pl = p.place;
    if (!pl) return;
    const key = pl.comunidade ? `c:${pl.comunidade.regionId}` : `l:${pl.local ?? pl.rotulo}`;
    const cur = m.get(key) ?? {
      key, nome: pl.comunidade?.nome ?? pl.local ?? pl.rotulo, detalhe: [pl.distrito?.nome, pl.municipio?.nome].filter(Boolean).join(' · '), comunidade: !!pl.comunidade, confianca: pl.comunidade?.confianca ?? null, total: 0,
    };
    cur.total += 1;
    m.set(key, cur);
  });
  return [...m.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}
