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
  const header = ['linha', 'id_ponto', 'status', 'codigo_unidade', 'contexto_unidade', 'candidatas', 'motivo', 'alertas'];
  if (includeCoordinates) header.push('latitude', 'longitude');
  const label = { matched: 'associado', unmatched: 'sem_correspondencia', ambiguous: 'ambiguo' };
  const rows = result.points.map((p) => {
    const row = [
      p.line ?? '', p.id ?? '', label[p.status], p.unitId ? unitCode.get(p.unitId) : '', p.unitId ? unitContext.get(p.unitId) : '',
      p.candidates.join(' '), p.reason ?? '', p.warnings.join(' | '),
    ];
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
