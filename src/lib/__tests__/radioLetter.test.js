import { describe, it, expect } from 'vitest';
import { buildRadioLetter, resolveSpeakableName, hasPlaceholders } from '../communicationUtils.js';
import { buildOutageView, EMPTY_OUTAGE_FORM } from '../outage.js';
import {
  renameRegion, removeRegionName, storeToCorrespondence, exportStore, importStore,
} from '../regionNames.js';
import { RADIO_LETTER } from '../../config.js';

const OUTAGE = buildOutageView(
  { ...EMPTY_OUTAGE_FORM, date: '2025-12-20', start: '08:00', end: '14:00' },
  { defaultAudience: 'Leopoldina' },
);
// Unidades de teste: códigos fictícios.
const U1 = { id: '1', code: '111', name: null, order: 1, context: [{ label: 'Distrito', value: 'Sereno' }, { label: 'Situação', value: 'Rural' }] };
const U2 = { id: '2', code: '222', name: null, order: 2, context: [] };
const U3 = { id: '3', code: '333', name: null, order: 3, context: [] };
const T0 = '2026-10-10T12:00:00.000Z';

describe('carta padrão para as rádios', () => {
  const names = { 111: 'Bela Vista', 222: 'Itapira', 333: 'Bela Vista' };
  const nameOf = (u) => names[u.code] ?? null;

  it('segue o modelo Energisa com data, horário e público no formato da carta', () => {
    const { text } = buildRadioLetter([U1, U2], OUTAGE, { nameOf });
    expect(text.startsWith('AVISO DE DESLIGAMENTO PROGRAMADO ENERGISA\n\nVocê sabe o que é Desligamento Programado?')).toBe(true);
    expect(text).toContain('Pessoal de LEOPOLDINA, no dia 20 DEZEMBRO 2025 de 08:00h às 14:00h, vamos precisar desligar a energia da sua região.');
    expect(text).toContain('ENDEREÇOS:\nBela Vista\nItapira\n\nA energia poderá ser restabelecida');
    expect(text.endsWith(RADIO_LETTER.closing[1])).toBe(true);
    expect(hasPlaceholders(text)).toBe(false);
  });

  it('ENDEREÇOS lista apenas nomes, sem repetir e sem códigos', () => {
    const { text, names: listed } = buildRadioLetter([U1, U2, U3], OUTAGE, { nameOf });
    expect(listed).toEqual(['Bela Vista', 'Itapira']);
    expect(text).not.toContain('111');
    expect(text).not.toContain('333');
  });

  it('região sem nome vira marcação com número e contexto (nunca o código) e bloqueia', () => {
    const r = buildRadioLetter([U1, U2], OUTAGE, { nameOf: (u) => (u.code === '222' ? 'Itapira' : null) });
    expect(r.text).toContain('[NOMEAR REGIÃO 01 — Sereno | Rural]');
    expect(r.text).not.toContain('111');
    expect(r.pendingUnits.map((u) => u.code)).toEqual(['111']);
    expect(hasPlaceholders(r.text)).toBe(true);
  });

  it('dados do desligamento ausentes ficam marcados, sem datas fictícias', () => {
    const r = buildRadioLetter([U2], buildOutageView(EMPTY_OUTAGE_FORM), { nameOf });
    expect(r.text).toContain('Pessoal de [PÚBLICO NÃO INFORMADO], no dia [DATA NÃO INFORMADA] de [HORÁRIO INICIAL] às [HORÁRIO FINAL]');
    expect(r.missingOutage).toEqual(['data', 'horário inicial', 'horário final', 'público (Pessoal de …)']);
  });

  it('público informado no formulário prevalece sobre o município padrão', () => {
    const o = buildOutageView({ ...EMPTY_OUTAGE_FORM, audience: 'Sereno e Glória' }, { defaultAudience: 'Cataguases' });
    expect(o.audience).toBe('SERENO E GLÓRIA');
  });

  it('nenhuma região selecionada gera carta vazia', () => {
    expect(buildRadioLetter([], OUTAGE, { nameOf }).text).toBe('');
  });
});

describe('nomes de região definidos pelo operador', () => {
  it('registra nome, anterior, responsável, data e histórico de alterações', () => {
    let store = renameRegion({}, {
      code: '111', name: '  Bela   Vista ', by: 'Ana (COP)', note: 'campo', at: T0,
    });
    expect(store['111'].current).toEqual({
      name: 'Bela Vista', by: 'Ana (COP)', at: T0, note: 'campo',
    });
    store = renameRegion(store, {
      code: '111', name: 'Córrego Bela Vista', by: 'Bruno', at: '2026-10-11T09:00:00.000Z',
    });
    expect(store['111'].history.map((h) => [h.action, h.previousName, h.name, h.by])).toEqual([
      ['definido', null, 'Bela Vista', 'Ana (COP)'],
      ['alterado', 'Bela Vista', 'Córrego Bela Vista', 'Bruno'],
    ]);
  });

  it('exige responsável e nome válido; não aceita colchetes', () => {
    expect(() => renameRegion({}, { code: '1', name: 'X Y', by: '' })).toThrow(/responsável/);
    expect(() => renameRegion({}, { code: '1', name: 'X', by: 'Ana' })).toThrow(/2 caracteres/);
    expect(() => renameRegion({}, { code: '1', name: '[Bela]', by: 'Ana' })).toThrow(/colchetes/);
  });

  it('remover mantém o histórico e devolve a região para "sem nome"', () => {
    let store = renameRegion({}, { code: '111', name: 'Bela Vista', by: 'Ana', at: T0 });
    store = removeRegionName(store, { code: '111', by: 'Ana', at: T0 });
    expect(store['111'].current).toBeNull();
    expect(store['111'].history.at(-1)).toMatchObject({ action: 'removido', previousName: 'Bela Vista' });
    expect(storeToCorrespondence(store)).toEqual({});
  });

  it('nome do operador entra no aviso com origem identificada', () => {
    const store = renameRegion({}, { code: '111', name: 'Bela Vista', by: 'Ana', at: T0 });
    const r = resolveSpeakableName(U1, { correspondence: storeToCorrespondence(store) });
    expect(r).toMatchObject({ name: 'Bela Vista', origin: 'operator' });
  });

  it('exporta e importa sem perder o histórico', () => {
    let store = renameRegion({}, { code: '111', name: 'Bela Vista', by: 'Ana', at: T0 });
    store = renameRegion(store, { code: '111', name: 'Córrego Bela Vista', by: 'Ana', at: '2026-10-11T00:00:00.000Z' });
    const json = exportStore(store, { name: 'Cataguases' });
    expect(json.entries).toEqual([expect.objectContaining({ code: '111', name: 'Córrego Bela Vista', validatedBy: 'Ana' })]);

    const { store: imported, count } = importStore({}, JSON.parse(JSON.stringify(json)), { by: 'Bruno', at: T0 });
    expect(count).toBe(1);
    expect(imported['111'].current.name).toBe('Córrego Bela Vista');
    expect(imported['111'].history.map((h) => h.action)).toEqual(['definido', 'alterado', 'importado']);
    expect(() => importStore({}, { foo: 1 })).toThrow(/entries/);
  });
});
