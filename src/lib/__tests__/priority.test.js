/**
 * Pontos prioritários — todos os dados abaixo são FICTÍCIOS.
 */
import { describe, it, expect } from 'vitest';
import {
  validateRecordForm, upsertRecord, setRecordStatus, deleteRecord, canDeleteRecord, filterRecords,
  haversineMeters, nextRecordId, EMPTY_RECORD_FORM,
} from '../priorityRecords.js';
import { createLocalPriorityRepository, createMemoryStorage, priorityScope } from '../priorityRepository.js';
import { matchPriorityPoints } from '../priorityMatch.js';
import {
  buildAnalysisRef, syncAlerts, transitionAlert, alertGate, alertKey, DECISIONS,
} from '../priorityAlerts.js';
import { mockSpatialJoin } from '../mockSpatialJoin.js';
import { buildDemoPriorityRecords } from '../../data/demoPriority.js';
import { DEMO_POINTS, DEMO_TERRITORIES } from '../../data/mockData.js';
import { PRIORITY_MATCH } from '../../config.js';

const M = 1 / 111320; // ~1 metro em latitude
const ORIGIN = { lat: -21.389, lng: -42.696 };
const form = (patch) => ({
  ...EMPTY_RECORD_FORM, id: 'PP-0001', lat: String(ORIGIN.lat), lng: String(ORIGIN.lng), category: 'A',
  situation: 'Equipamento vital validado (fictício)', registeredOn: '2026-10-01', ...patch,
});
const TODAY = '2026-10-10';
const save = (records, patch, opts = {}) => {
  const v = validateRecordForm(form(patch), records, { today: TODAY, editingId: opts.editingId });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return upsertRecord(records, v.value, { by: 'Operador Teste', at: '2026-10-10T10:00:00Z', ...opts });
};
const rec = (id, dLatMeters, patch = {}) => ({
  id, category: 'A', status: 'active', lat: ORIGIN.lat + dLatMeters * M, lng: ORIGIN.lng, ucCode: '', ...patch,
});
const pt = (key, dLatMeters, patch = {}) => ({
  key, id: key, line: null, lat: ORIGIN.lat + dLatMeters * M, lng: ORIGIN.lng, client: null, ...patch,
});
const run = (points, records, opts = {}) => matchPriorityPoints({
  points, records, toleranceMeters: 30, sharedIdField: 'client', sharedIdMapped: true, crs: 'EPSG:4326', ...opts,
});

describe('cadastro de pontos prioritários', () => {
  it('1. cadastro válido de um ponto prioritário', () => {
    const records = save([], {});
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'PP-0001', category: 'A', status: 'active', createdBy: 'Operador Teste' });
    expect(records[0].history[0].action).toBe('criado');
    expect(nextRecordId(records)).toBe('PP-0002');
  });

  it('categoria B exige atividade e impacto', () => {
    const v = validateRecordForm(form({ category: 'B' }), [], { today: TODAY });
    expect(v.errors.activity).toBeTruthy();
    expect(v.errors.impact).toBeTruthy();
  });

  it('2. rejeita coordenadas inválidas', () => {
    const errs = (p) => validateRecordForm(form(p), [], { today: TODAY }).errors;
    expect(errs({ lat: '91' }).lat).toMatch(/-90 e 90/);
    expect(errs({ lng: '-181' }).lng).toMatch(/-180 e 180/);
    expect(errs({ lat: 'abc' }).lat).toMatch(/inválida/);
    expect(errs({ lat: '' }).lat).toMatch(/Informe/);
    expect(errs({ lat: '0', lng: '0' }).lat).toMatch(/0, 0/);
    expect(errs({ lat: '-21,389', lng: '-42,696' })).toEqual({});
  });

  it('3. avisa possível duplicidade sem bloquear', () => {
    const records = save([], {});
    const v = validateRecordForm(form({ id: 'PP-0002', lat: String(ORIGIN.lat + 5 * M) }), records, { today: TODAY });
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => w.code)).toContain('duplicate-location');
    expect(save(records, { id: 'PP-0002', lat: String(ORIGIN.lat + 5 * M) })).toHaveLength(2);
  });

  it('4. edição e desativação mantêm histórico; exclusão só sem alertas', () => {
    let records = save([], {});
    records = save(records, { notes: 'Contato pela equipe X' }, { editingId: 'PP-0001' });
    expect(records[0].notes).toBe('Contato pela equipe X');
    expect(records[0].history.at(-1)).toMatchObject({ action: 'editado', fields: ['observações'] });
    records = setRecordStatus(records, 'PP-0001', 'inactive', { by: 'Operador Teste' });
    expect(records[0].status).toBe('inactive');
    expect(records[0].history.map((h) => h.action)).toEqual(['criado', 'editado', 'desativado']);
    const alerts = { k: { recordId: 'PP-0001' } };
    expect(canDeleteRecord('PP-0001', alerts)).toBe(false);
    expect(() => deleteRecord(records, 'PP-0001', alerts)).toThrow(/Desative/);
    expect(deleteRecord(records, 'PP-0001', {})).toHaveLength(0);
    expect(filterRecords(records, { status: 'active' })).toHaveLength(0);
  });

  it('5. persiste após "atualizar a página" (novo repositório, mesmo armazenamento)', async () => {
    const storage = createMemoryStorage();
    const repo1 = createLocalPriorityRepository({ scope: 'real:3115300', storage });
    await repo1.saveRecords(save([], {}));
    await repo1.saveAlerts({ a: { recordId: 'PP-0001', history: [] } });
    const repo2 = createLocalPriorityRepository({ scope: 'real:3115300', storage });
    expect((await repo2.loadRecords()).map((r) => r.id)).toEqual(['PP-0001']);
    expect(Object.keys(await repo2.loadAlerts())).toEqual(['a']);
  });
});

describe('comparação com os pontos do CSV', () => {
  it('distância Haversine coerente (~111 m por milésimo de grau de latitude)', () => {
    expect(haversineMeters(-21, -42, -21.001, -42)).toBeGreaterThan(110);
    expect(haversineMeters(-21, -42, -21.001, -42)).toBeLessThan(112);
  });

  it('6. dentro da tolerância: possível; com código da UC coincidente: confirmada', () => {
    const r1 = run([pt('P1', 12)], [rec('PP-1', 0)]);
    expect(r1.alerts[0]).toMatchObject({ recordId: 'PP-1', matchStatus: 'possible', distanceMeters: expect.any(Number) });
    expect(r1.alerts[0].distanceMeters).toBeCloseTo(12, 0);
    const r2 = run([pt('P1', 12, { client: 'uc 123' })], [rec('PP-1', 0, { ucCode: 'UC123' })]);
    expect(r2.alerts[0].matchStatus).toBe('confirmed');
    expect(r2.counts).toMatchObject({ confirmed: 1, possible: 0, review: 0, unmatchedPoints: 0 });
  });

  it('7. fora da tolerância não gera alerta (sem identificador); com identificador vai para revisão', () => {
    const r1 = run([pt('P1', 45)], [rec('PP-1', 0)]);
    expect(r1.alerts).toHaveLength(0);
    expect(r1.counts.unmatchedPoints).toBe(1);
    const r2 = run([pt('P1', 45, { client: 'UC9' })], [rec('PP-1', 0, { ucCode: 'UC9' })]);
    expect(r2.alerts[0].matchStatus).toBe('review');
    expect(r2.alerts[0].reasons[0]).toMatch(/acima da tolerância/);
  });

  it('8. coordenadas inválidas no CSV não são comparadas e são sinalizadas', () => {
    const r = run([pt('P1', 0, { lat: NaN }), pt('P2', 500)], [rec('PP-1', 0)], { invalidCount: 3 });
    expect(r.analyzed).toBe(1);
    expect(r.notCompared).toBe(3);
    expect(r.warnings.join(' ')).toMatch(/3 registro\(s\) do CSV com coordenadas inválidas/);
    expect(r.warnings.join(' ')).toMatch(/1 ponto\(s\) sem coordenada/);
    const blocked = run([pt('P1', 0)], [rec('PP-1', 0)], { crs: 'projected' });
    expect(blocked.blocked).toBe(true);
    expect(blocked.alerts).toHaveLength(0);
  });

  it('9. dois cadastros no mesmo local: o confirmado por identificador e o outro em revisão', () => {
    const r = run([pt('P1', 3, { client: 'UC1' })], [rec('PP-1', 0, { ucCode: 'UC1' }), rec('PP-2', 0, { ucCode: 'UC2' })]);
    const byId = Object.fromEntries(r.alerts.map((a) => [a.recordId, a.matchStatus]));
    expect(byId).toEqual({ 'PP-1': 'confirmed', 'PP-2': 'review' });
  });

  it('10. um ponto do CSV próximo de mais de um cadastro: ambiguidade sinalizada para ambos', () => {
    const r = run([pt('P1', 0)], [rec('PP-1', 10), rec('PP-2', -15)]);
    expect(r.alerts.map((a) => a.matchStatus)).toEqual(['review', 'review']);
    expect(r.alerts[0].reasons[0]).toMatch(/Ambiguidade/);
    expect(r.counts.review).toBe(2);
  });

  it('11. CSV sem correspondências', () => {
    const r = run([pt('P1', 1000), pt('P2', 2000)], [rec('PP-1', 0)]);
    expect(r.alerts).toHaveLength(0);
    expect(r.counts).toEqual({ confirmed: 0, possible: 0, review: 0, unmatchedPoints: 2 });
  });

  it('12. cadastro inativo não gera alerta', () => {
    const r = run([pt('P1', 0)], [rec('PP-1', 0, { status: 'inactive' })]);
    expect(r.alerts).toHaveLength(0);
    expect(r.inactiveRecords).toBe(1);
  });

  it('sem coluna de identificador, nada é confirmado', () => {
    const r = run([pt('P1', 0, { client: 'UC1' })], [rec('PP-1', 0, { ucCode: 'UC1' })], { sharedIdMapped: false });
    expect(r.alerts[0].matchStatus).toBe('possible');
  });
});

describe('demonstração × dados reais', () => {
  it('13. escopos separados: dados fictícios da demo não aparecem no teste real', async () => {
    const storage = createMemoryStorage();
    const demo = createLocalPriorityRepository({ scope: priorityScope('demo'), storage, seed: buildDemoPriorityRecords });
    const real = createLocalPriorityRepository({ scope: priorityScope('real', '3115300'), storage });
    const demoRecords = await demo.loadRecords();
    expect(demoRecords.every((r) => r.fictitious)).toBe(true);
    expect(await real.loadRecords()).toEqual([]);
    await real.saveRecords(save([], {}));
    expect((await demo.loadRecords()).map((r) => r.id)).not.toContain('PP-0001');
  });

  it('a demonstração mostra possível, ambiguidade, sem alerta e inativo', () => {
    const res = mockSpatialJoin(DEMO_POINTS, DEMO_TERRITORIES);
    const r = matchPriorityPoints({
      points: res.points, records: buildDemoPriorityRecords(), toleranceMeters: PRIORITY_MATCH.toleranceMeters,
    });
    const byId = Object.fromEntries(r.alerts.map((a) => [a.recordId, a.matchStatus]));
    expect(byId).toEqual({
      'DEMO-A-01': 'possible', 'DEMO-A-02': 'review', 'DEMO-B-01': 'possible', 'DEMO-B-02': 'review',
    });
  });
});

describe('alertas e fluxo de revisão', () => {
  const ref = buildAnalysisRef({
    outageId: 'DP-TESTE-1', dateLabel: '20/10/2026', fileName: 'teste.csv', processedAt: '2026-10-10T10:00:00Z',
  });
  const analysis = run([pt('P1', 0), pt('P2', 2000)], [rec('PP-A', 5), rec('PP-B', 2000, { category: 'B' })]);

  it('14. mapa e painel vêm da mesma análise (contagens consistentes)', () => {
    const { counts, alerts, involvedPointKeys, analyzed } = analysis;
    expect(counts.confirmed + counts.possible + counts.review).toBe(alerts.length);
    expect(involvedPointKeys.sort()).toEqual(['P1', 'P2']);
    expect(counts.unmatchedPoints).toBe(analyzed - involvedPointKeys.length);
    const store = syncAlerts({}, analysis, ref, { at: 't0' });
    expect(Object.keys(store)).toHaveLength(alerts.length);
    expect(syncAlerts(store, analysis, ref)).toBe(store); // sem mudanças → mesmo objeto
  });

  it('15. vital pendente bloqueia a validação; só a conclusão explícita libera', () => {
    let store = syncAlerts({}, analysis, ref, { at: 't0' });
    const keyA = alertKey(ref.key, 'PP-A');
    expect(alertGate(analysis, store, ref)).toMatchObject({ blocked: true });
    // Abrir detalhes / copiar a carta não altera o store (nenhuma função é chamada).
    store = transitionAlert(store, keyA, { action: 'analisar', by: 'Ana' });
    expect(alertGate(analysis, store, ref).blocked).toBe(true);
    expect(() => transitionAlert(store, keyA, { action: 'concluir', by: 'Ana' })).toThrow(/decisão/);
    expect(() => transitionAlert(store, keyA, { action: 'concluir', decision: DECISIONS[0] })).toThrow(/responsável/);
    store = transitionAlert(store, keyA, { action: 'concluir', by: 'Ana', decision: DECISIONS[1], note: 'ok' });
    const gate = alertGate(analysis, store, ref);
    expect(gate.blocked).toBe(false);
    expect(gate.pendingOther.map((a) => a.recordId)).toEqual(['PP-B']);
    expect(store[keyA].history.map((h) => h.action)).toEqual(['gerado', 'analisar', 'concluir']);
    store = transitionAlert(store, keyA, { action: 'reabrir', by: 'Ana', note: 'nova informação' });
    expect(alertGate(analysis, store, ref).blocked).toBe(true);
  });

  it('o histórico do alerta não guarda coordenadas do CSV', () => {
    const store = syncAlerts({}, analysis, ref);
    expect(JSON.stringify(store)).not.toMatch(/-21\.38|-42\.69/);
  });
});

describe('reavaliação de alertas', () => {
  it('conclusão é reaberta quando a correspondência muda (ex.: surge ambiguidade)', () => {
    const ref = buildAnalysisRef({ outageId: 'DP-T', dateLabel: '20/10/2026', fileName: 't.csv' });
    const a1 = run([pt('P1', 0)], [rec('PP-A', 5)]);
    let store = syncAlerts({}, a1, ref);
    const key = alertKey(ref.key, 'PP-A');
    store = transitionAlert(store, key, { action: 'concluir', by: 'Ana', decision: DECISIONS[0] });
    const a2 = run([pt('P1', 0)], [rec('PP-A', 5), rec('PP-NOVO', -8)]);
    store = syncAlerts(store, a2, ref);
    expect(store[key].status).toBe('novo');
    expect(store[key].history.at(-1)).toMatchObject({ action: 'reavaliado', from: 'concluido', to: 'novo' });
    expect(alertGate(a2, store, ref).blocked).toBe(true);
  });
});
