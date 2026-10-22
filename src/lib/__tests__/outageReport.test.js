import { describe, it, expect } from 'vitest';
import { buildReport, reportToCsv } from '../outageReport.js';

const rec = (id, data, tipo, comms, extra = {}) => ({
  id, ordem: id, tipo, data, duracaoH: 2, alimentador: 'F1', motivo: tipo === 'acidental' ? 'Queda de árvore ou galho' : 'Poda',
  comunidades: comms.map(([key, pontos]) => ({ key, nome: key, pontos })), totalPontos: comms.reduce((s, [, p]) => s + p, 0),
  antecedenciaDias: tipo === 'programado' ? 4 : null, status: 'aprovado', ...extra,
});
const NOW = Date.UTC(2026, 10, 10);
const HIST = [
  rec('P1', '2026-10-01', 'programado', [['A', 3], ['B', 2]]),
  rec('P2', '2026-11-01', 'programado', [['A', 4]], { antecedenciaDias: 2 }),
  rec('C1', '2026-11-05', 'acidental', [['A', 1], ['C', 5]], { duracaoH: 3.5 }),
  rec('X', '2026-11-06', 'programado', [['A', 1]], { status: 'cancelado' }),
  rec('OLD', '2025-01-01', 'acidental', [['A', 1]]),
];

describe('buildReport', () => {
  it('todos: soma os dois tipos e separa por tipo em cada linha', () => {
    const r = buildReport(HIST, { now: NOW });
    expect(r.summary).toMatchObject({ total: 4, programado: 2, acidental: 2, horas: 9.5, pontos: 16, comunidades: 3, antecedenciaMedia: 3 });
    expect(r.communities[0]).toMatchObject({ key: 'A', total: 4, programado: 2, acidental: 2, pontos: 9, ultimo: '2026-11-05' });
    expect(r.reasons.map((x) => x.label)).toEqual(['Queda de árvore ou galho', 'Poda']); // empate em quantidade: mais horas primeiro
  });
  it('recorte por tipo e por período', () => {
    expect(buildReport(HIST, { scope: 'acidental', now: NOW }).summary.total).toBe(2);
    const r = buildReport(HIST, { scope: 'acidental', period: '90', now: NOW });
    expect(r.summary).toMatchObject({ total: 1, programado: 0, acidental: 1, antecedenciaMedia: null });
    expect(r.communities.map((c) => c.key).sort()).toEqual(['A', 'C']);
  });
  it('CSV em seções', () => {
    const csv = reportToCsv(buildReport(HIST, { now: NOW }), { scopeLabel: 'Todos', periodLabel: 'Todo o histórico' });
    expect(csv).toContain('Por comunidade');
    expect(csv).toContain('A;4;2;2;9,5;9;2026-11-05');
  });
});
