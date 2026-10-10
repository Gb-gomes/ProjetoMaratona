import { describe, it, expect } from 'vitest';
import {
  buildUnitNotice, resolveSpeakableName, hasPlaceholders, buildTraditionalFromNames,
} from '../communicationUtils.js';
import { buildOutageView, EMPTY_OUTAGE_FORM } from '../outage.js';

const OUTAGE = buildOutageView({ ...EMPTY_OUTAGE_FORM, date: '2026-10-20', start: '13:00', end: '17:30', noticeDate: '2026-10-15' });
const U1 = { id: '1', code: '510000000000001', name: null };
const U2 = { id: '2', code: '510000000000002', name: null };
const U3 = { id: '3', code: '510000000000003', name: 'NOME OFICIAL' };
// Correspondência validada (dados de teste)
const CORR = {
  510000000000001: { name: 'Alfa', validatedBy: 'teste', validatedOn: '2026-01-01' },
  510000000000002: { name: 'Beta', validatedBy: 'teste', validatedOn: '2026-01-01' },
};

describe('buildUnitNotice', () => {
  it('10. várias unidades selecionadas', () => {
    const r = buildUnitNotice([U1, U2], OUTAGE, { correspondence: CORR });
    expect(r.text).toBe('Atenção, moradores de Alfa e Beta. A Energisa informa que haverá um desligamento programado de energia elétrica em 20 de outubro de 2026, das 13h às 17h30.');
    expect(r.pendingCodes).toEqual([]);
    expect(hasPlaceholders(r.text)).toBe(false);
  });

  it('11. uma única unidade selecionada', () => {
    const r = buildUnitNotice([U1], OUTAGE, { correspondence: CORR });
    expect(r.text.startsWith('Atenção, moradores de Alfa. A Energisa')).toBe(true);
  });

  it('12. nenhuma unidade selecionada gera texto vazio', () => {
    expect(buildUnitNotice([], OUTAGE).text).toBe('');
  });

  it('não inventa nome: unidade sem correspondência validada vira pendência com o código oficial', () => {
    const r = buildUnitNotice([U1, U3], OUTAGE, { correspondence: {}, unitType: 'Setor censitário' });
    expect(r.pendingCodes).toEqual([U1.code, U3.code]);
    expect(r.text).toContain(`[denominação pendente de validação — setor censitário ${U1.code}]`);
    expect(hasPlaceholders(r.text)).toBe(true);
  });

  it('usa nome oficial somente quando a configuração o aprova', () => {
    expect(resolveSpeakableName(U3, { officialNameApproved: false }).name).toBeNull();
    expect(resolveSpeakableName(U3, { officialNameApproved: true })).toEqual({ name: 'NOME OFICIAL', origin: 'official' });
  });

  it('sem data/horário, mantém marcações e informa o que falta (sem data fictícia)', () => {
    const r = buildUnitNotice([U1], buildOutageView(EMPTY_OUTAGE_FORM), { correspondence: CORR });
    expect(r.missingOutage).toEqual(['data', 'horário inicial', 'horário final']);
    expect(r.text).toContain('[data não informada]');
    expect(hasPlaceholders(r.text)).toBe(true);
  });
});

describe('buildOutageView', () => {
  it('calcula a antecedência e marca o que não foi informado', () => {
    expect(OUTAGE.noticeDaysBefore).toBe(5);
    expect(OUTAGE.dateLabel).toBe('20/10/2026');
    const empty = buildOutageView(EMPTY_OUTAGE_FORM);
    expect(empty.dateLabel).toBe('Não informado');
    expect(empty.noticeDaysBefore).toBeNull();
  });

  it('aponta horários e datas incoerentes', () => {
    const v = buildOutageView({ ...EMPTY_OUTAGE_FORM, date: '2026-10-20', start: '17:00', end: '13:00', noticeDate: '2026-10-25' });
    expect(v.problems).toHaveLength(2);
  });
});

describe('buildTraditionalFromNames', () => {
  it('lista nomes únicos de propriedade do CSV ou nada quando não há coluna', () => {
    expect(buildTraditionalFromNames(['Faz. A', 'Faz. A', 'Sítio B'], OUTAGE)).toMatch(/^Atenção aos clientes Faz\. A e Sítio B\./);
    expect(buildTraditionalFromNames([], OUTAGE)).toBe('');
  });
});
