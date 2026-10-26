/**
 * Relatório do histórico de desligamentos: visão geral (programado + acidental)
 * ou de um tipo só, sem depender de um desligamento em análise.
 * Só agrega o que está salvo (sem dado de cliente).
 */
import { typeOf, dayMs, communityLabel } from './outageFacts.js';

export const PERIODS = [
  { value: 'all', label: 'Todo o histórico', days: null },
  { value: '30', label: 'Últimos 30 dias', days: 30 },
  { value: '90', label: 'Últimos 90 dias', days: 90 },
  { value: '365', label: 'Últimos 12 meses', days: 365 },
];

const round1 = (n) => Math.round(n * 10) / 10;
const todayMs = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Agrupa por chave somando contagem por tipo, horas e pontos. */
function groupBy(records, keysOf) {
  const map = new Map();
  records.forEach((r) => {
    keysOf(r).forEach(({ key, label, pontos = 0 }) => {
      if (!map.has(key)) map.set(key, { key, label, total: 0, programado: 0, acidental: 0, horas: 0, pontos: 0, ultimo: null });
      const g = map.get(key);
      g.total += 1;
      g[typeOf(r)] += 1;
      g.horas += r.duracaoH ?? 0;
      g.pontos += pontos;
      if (r.data && (!g.ultimo || r.data > g.ultimo)) g.ultimo = r.data;
    });
  });
  return [...map.values()]
    .map((g) => ({ ...g, horas: round1(g.horas) }))
    .sort((a, b) => b.total - a.total || b.horas - a.horas || b.pontos - a.pontos || a.label.localeCompare(b.label, 'pt-BR'));
}

/**
 * @param {object[]} records histórico (todos os tipos)
 * @param {{ scope?: 'todos'|'programado'|'acidental', period?: string, now?: number }} options
 */
export function buildReport(records, { scope = 'todos', period = 'all', now = todayMs() } = {}) {
  const days = PERIODS.find((p) => p.value === period)?.days ?? null;
  const inPeriod = (r) => days == null || (dayMs(r.data) != null && dayMs(r.data) >= now - days * 86400000 && dayMs(r.data) <= now);
  const list = (records ?? []).filter((r) => r.status !== 'cancelado' && inPeriod(r) && (scope === 'todos' || typeOf(r) === scope));

  const programados = list.filter((r) => typeOf(r) === 'programado');
  const notices = programados.map((r) => r.antecedenciaDias).filter((n) => Number.isFinite(n) && n >= 0);
  const withDuration = list.filter((r) => r.duracaoH);
  const communities = groupBy(list, (r) => (r.comunidades ?? []).map((c) => ({ key: c.key, label: communityLabel(c), pontos: c.pontos })));

  return {
    scope,
    period,
    summary: {
      total: list.length,
      programado: programados.length,
      acidental: list.length - programados.length,
      horas: round1(list.reduce((s, r) => s + (r.duracaoH ?? 0), 0)),
      duracaoMedia: withDuration.length ? round1(withDuration.reduce((s, r) => s + r.duracaoH, 0) / withDuration.length) : null,
      pontos: list.reduce((s, r) => s + (r.totalPontos ?? 0), 0),
      comunidades: communities.length,
      antecedenciaMedia: notices.length ? round1(notices.reduce((s, n) => s + n, 0) / notices.length) : null,
    },
    communities,
    feeders: groupBy(list, (r) => [{ key: (r.alimentador ?? '').trim().toUpperCase() || '—', label: r.alimentador?.trim() || 'Não informado', pontos: r.totalPontos ?? 0 }]),
    reasons: groupBy(list, (r) => [{ key: (r.motivo ?? '').trim().toLowerCase() || '—', label: r.motivo?.trim() || 'Não informado', pontos: r.totalPontos ?? 0 }]),
  };
}

/** CSV do relatório: resumo e as três tabelas, em seções (separador ";"). */
export function reportToCsv(report, { scopeLabel, periodLabel }) {
  const cell = (v) => {
    const s = v == null ? '' : String(v).replace('.', ',');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cols) => cols.map(cell).join(';');
  const s = report.summary;
  const table = (title, first, rows) => [
    '', title,
    row(first, 'Desligamentos', 'Programados', 'Acidentais', 'Horas sem energia', 'Pontos afetados', 'Último'),
    ...rows.map((g) => row(g.label, g.total, g.programado, g.acidental, g.horas, g.pontos, g.ultimo ?? '')),
  ];
  return [
    row('Relatório de desligamentos', scopeLabel, periodLabel),
    row('Desligamentos', s.total), row('Programados', s.programado), row('Acidentais', s.acidental),
    row('Horas sem energia', s.horas), row('Duração média (h)', s.duracaoMedia ?? ''),
    row('Pontos afetados', s.pontos), row('Comunidades afetadas', s.comunidades),
    row('Antecedência média do aviso (dias)', s.antecedenciaMedia ?? ''),
    ...table('Por comunidade', 'Comunidade', report.communities),
    ...table('Por alimentador', 'Alimentador', report.feeders),
    ...table('Por motivo / causa', 'Motivo / causa', report.reasons),
  ].join('\n');
}
