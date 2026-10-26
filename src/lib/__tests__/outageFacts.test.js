import { describe, it, expect } from 'vitest';
import {
  computeFacts, durationHours, buildOutageRecord, communityLabel,
} from '../outageFacts.js';

const rec = (id, data, comms, extra = {}) => ({
  id, ordem: `OS-${id}`, data, inicio: '08:00', termino: '12:00', duracaoH: 4,
  comunidades: comms.map((k) => ({ key: k, nome: k, pontos: 5 })), status: 'aprovado', ...extra,
});

describe('durationHours', () => {
  it('calcula horas e recusa intervalo inválido', () => {
    expect(durationHours('08:00', '14:30')).toBe(6.5);
    expect(durationHours('14:00', '08:00')).toBeNull();
    expect(durationHours('', '08:00')).toBeNull();
  });
});

describe('computeFacts', () => {
  it('sem histórico: só o aviso de primeiro registro', () => {
    const f = computeFacts(rec('a', '2026-11-05', ['PALMEIRAS']), []);
    expect(f.historyCount).toBe(0);
    expect(f.level).toBe('info');
    expect(f.alerts[0].text).toMatch(/Primeiro desligamento/);
  });

  it('comunidade recorrente em 30 dias gera alerta alto com as referências', () => {
    const hist = [rec('1', '2026-10-10', ['PALMEIRAS']), rec('2', '2026-10-25', ['PALMEIRAS']), rec('3', '2026-06-01', ['PALMEIRAS'])];
    const f = computeFacts(rec('a', '2026-11-05', ['PALMEIRAS']), hist);
    expect(f.level).toBe('alta');
    const a = f.alerts.find((x) => /3º desligamento/.test(x.text));
    expect(a.refs.map((r) => r.ordem).sort()).toEqual(['OS-1', 'OS-2']);
    expect(f.byCommunity[0].hours90).toBe(8);
    expect(f.byCommunity[0].last.daysAgo).toBe(11);
  });

  it('desligamento próximo nas mesmas comunidades sugere agrupar; o próprio registro e cancelados não contam', () => {
    const hist = [rec('1', '2026-11-12', ['PALMEIRAS']), rec('a', '2026-11-05', ['PALMEIRAS']), rec('x', '2026-11-04', ['PALMEIRAS'], { status: 'cancelado' })];
    const f = computeFacts(rec('a', '2026-11-05', ['PALMEIRAS']), hist);
    expect(f.historyCount).toBe(1);
    expect(f.alerts.some((x) => /agrupar/.test(x.text) && x.refs[0].ordem === 'OS-1')).toBe(true);
  });

  it('mesmo dia e horário sobreposto é conflito', () => {
    const f = computeFacts(rec('a', '2026-11-05', ['PALMEIRAS']), [rec('1', '2026-11-05', ['PALMEIRAS'], { inicio: '10:00', termino: '15:00' })]);
    expect(f.alerts[0]).toMatchObject({ level: 'alta' });
    expect(f.alerts[0].text).toMatch(/mesmo dia/);
  });

  it('alimentador recorrente e antecedência abaixo da média', () => {
    const hist = [
      rec('1', '2026-09-01', ['A'], { alimentador: 'leo-07', antecedenciaDias: 6 }),
      rec('2', '2026-10-01', ['B'], { alimentador: 'LEO-07', antecedenciaDias: 4 }),
    ];
    const f = computeFacts(rec('a', '2026-11-05', ['C'], { alimentador: 'LEO-07', antecedenciaDias: 2 }), hist);
    expect(f.feeder.count).toBe(2);
    expect(f.alerts.some((x) => /Alimentador LEO-07: 3/.test(x.text))).toBe(true);
    expect(f.alerts.some((x) => /abaixo da média registrada \(5 dias\)/.test(x.text))).toBe(true);
  });
});

describe('agrupamento dos alertas', () => {
  it('comunidades com o mesmo alerta e as mesmas referências ficam numa linha só', () => {
    const f = computeFacts(rec('a', '2026-11-05', ['A', 'B']), [rec('1', '2026-10-30', ['A', 'B'])]);
    const lines = f.alerts.filter((x) => /teve desligamento/.test(x.text));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^A e B: teve desligamento programado há 6 dia/);
  });
});

describe('programado x acidental', () => {
  const hist = [
    rec('1', '2026-10-20', ['A'], { alimentador: 'F1' }),
    rec('2', '2026-10-25', ['A'], { tipo: 'acidental', alimentador: 'F1' }),
    rec('3', '2026-10-30', ['A'], { tipo: 'acidental', alimentador: 'F1' }),
  ];
  it('todos: soma os dois tipos e detalha a composição', () => {
    const f = computeFacts(rec('a', '2026-11-05', ['A'], { alimentador: 'F1' }), hist);
    expect(f.counts).toEqual({ todos: 3, programado: 1, acidental: 2 });
    const a = f.alerts.find((x) => /4º desligamento/.test(x.text));
    expect(a.text).toMatch(/antes deste: 1 programado e 2 acidentais/);
    expect(a.refs.map((r) => r.tipo).sort()).toEqual(['acidental', 'acidental', 'programado']);
  });
  it('filtro por tipo considera só aquele tipo', () => {
    const f = computeFacts(rec('a', '2026-11-05', ['A']), hist, { scope: 'acidental' });
    expect(f.historyCount).toBe(2);
    expect(f.byCommunity[0].recent).toHaveLength(2);
    const p = computeFacts(rec('a', '2026-11-05', ['A']), hist, { scope: 'programado' });
    expect(p.byCommunity[0].recent).toHaveLength(1);
    expect(p.alerts.some((x) => /teve desligamento programado há 16 dia/.test(x.text))).toBe(true);
  });
  it('acidental não sugere agrupar nem compara antecedência', () => {
    const f = computeFacts(rec('a', '2026-10-21', ['A'], { tipo: 'acidental', antecedenciaDias: null }), [rec('1', '2026-10-28', ['A'], { antecedenciaDias: 5 })]);
    expect(f.alerts.some((x) => /agrupar|antecedência/.test(x.text))).toBe(false);
  });
});

describe('buildOutageRecord', () => {
  it('guarda só dados do sistema e soma os pontos', () => {
    const r = buildOutageRecord({
      id: 'x', mode: 'real', by: 'ana',
      form: { orderId: ' OS-9 ', feeder: '', reason: 'Poda', date: '2026-11-05', start: '08:00', end: '12:00', noticeDate: '2026-11-01' },
      outageView: { noticeDaysBefore: 4 },
      units: [{ id: 'u1', code: '3138401-PALMEIRAS', count: 7, distritos: [{ cod: '313840110', nome: 'Ribeiro Junqueira' }], municipio: { nome: 'Leopoldina' } }, { id: 'u2', code: '3138401-TRES', count: 3 }],
      nameOf: (u) => (u.id === 'u1' ? 'Palmeiras' : null),
      keyOf: (u) => u.code,
    });
    expect(r).toMatchObject({ tipo: 'programado', ordem: 'OS-9', alimentador: null, duracaoH: 4, antecedenciaDias: 4, totalPontos: 10 });
    expect(r.comunidades).toEqual([
      { key: '3138401-PALMEIRAS', nome: 'Palmeiras', distrito: 'Ribeiro Junqueira', municipio: 'Leopoldina', pontos: 7 },
      { key: '3138401-TRES', nome: '3138401-TRES', distrito: null, municipio: null, pontos: 3 },
    ]);
    expect(communityLabel(r.comunidades[0])).toBe('Palmeiras (distrito de Ribeiro Junqueira)');
    expect(communityLabel({ nome: 'Palmeiras', distrito: 'Leopoldina, Ribeiro Junqueira' })).toBe('Palmeiras (distritos de Leopoldina e Ribeiro Junqueira)');
    expect(communityLabel({ nome: 'Área urbana de Leopoldina', distrito: 'Leopoldina' })).toBe('Área urbana de Leopoldina');
  });
});

describe('buildOutageRecord acidental', () => {
  it('não guarda data de aviso nem antecedência', () => {
    const r = buildOutageRecord({
      id: 'y', mode: 'real',
      form: { type: 'acidental', orderId: 'OC-1', date: '2026-11-05', start: '14:10', end: '16:40', noticeDate: '2026-11-01' },
      outageView: { noticeDaysBefore: null },
      units: [{ id: 'u1', code: 'X', count: 2 }], nameOf: () => 'X', keyOf: (u) => u.code,
    });
    expect(r).toMatchObject({ tipo: 'acidental', dataAviso: null, antecedenciaDias: null, duracaoH: 2.5, status: 'registrado' });
  });
});

describe('aba acidental', () => {
  it('duração atravessa a meia-noite com a data do restabelecimento', () => {
    expect(durationHours('22:30', '01:00', '2026-11-05', '2026-11-06')).toBe(2.5);
    expect(durationHours('22:30', '01:00', '2026-11-05', '2026-11-05')).toBeNull();
  });
  it('causa recorrente nas mesmas comunidades sugere ação preventiva', () => {
    const hist = [rec('1', '2026-09-20', ['A'], { tipo: 'acidental', motivo: 'Queda de árvore ou galho' })];
    const f = computeFacts(rec('a', '2026-11-05', ['A'], { tipo: 'acidental', motivo: 'Queda de árvore ou galho' }), hist);
    const a = f.alerts.find((x) => /Causa recorrente/.test(x.text));
    expect(a.level).toBe('alta');
    expect(a.text).toMatch(/2 vezes em 90 dias.*poda preventiva/);
    expect(a.refs[0].ordem).toBe('OS-1');
  });
  it('registro acidental guarda data de fim, equipamento e observações', () => {
    const r = buildOutageRecord({
      id: 'z', mode: 'real',
      form: { type: 'acidental', orderId: 'OC-9', date: '2026-11-05', start: '22:00', endDate: '2026-11-06', end: '02:30', device: 'Religador R-12', notes: 'Chuva forte' },
      outageView: {}, units: [], nameOf: () => '', keyOf: (u) => u.id,
    });
    expect(r).toMatchObject({ dataFim: '2026-11-06', duracaoH: 4.5, equipamento: 'Religador R-12', observacoes: 'Chuva forte' });
  });
});
