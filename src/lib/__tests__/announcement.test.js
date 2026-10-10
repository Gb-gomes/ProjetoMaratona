import { describe, it, expect } from 'vitest';
import { buildAnnouncement, countClients } from '../announcement.js';
import { resolveSpeakableName, buildRadioLetterFromLines, hasPlaceholders } from '../communicationUtils.js';
import { validateLayer } from '../layer.js';
import { renameRegion, storeToCorrespondence } from '../regionNames.js';
import { PILOT_CONFIG } from '../../config.js';

// Unidades e pontos de teste (fictícios).
const A = { id: 'A', code: 'A', order: 1, fallbackName: 'Zona rural de Sereno' };
const B = { id: 'B', code: 'B', order: 2, fallbackName: 'Zona rural de Glória' };
const pt = (unitId, client, property) => ({
  status: 'matched', unitId, client, property,
});
const POINTS = [
  pt('A', 'c1', 'Fazenda Boa Vista'), pt('A', 'c2', 'Sítio Ipê'), pt('A', 'c3', 'Fazenda Palmares'),
  pt('B', 'c4', 'Fazenda Santa Rita'), pt('B', 'c5', 'Sítio do João'),
  { status: 'unmatched', unitId: null, client: 'c9', property: 'Fora' },
];
const nameOf = (u) => u.fallbackName;
const base = {
  nameOf, threshold: 3, clientMapped: true, propertyMapped: true,
};

describe('regra: menos de 3 clientes → cita as propriedades', () => {
  it('região com 3 clientes é citada pelo nome; com 2, pelas fazendas', () => {
    const r = buildAnnouncement([A, B], POINTS, base);
    expect(r.items.map((it) => [it.unit.id, it.mode, it.clients])).toEqual([['A', 'region', 3], ['B', 'properties', 2]]);
    expect(r.lines).toEqual(['Zona rural de Sereno', 'Fazenda Santa Rita', 'Sítio do João']);
    expect(r.notes[0]).toMatch(/1 região\(ões\) citada\(s\) pelo nome das propriedades/);
  });

  it('conta clientes únicos quando a coluna de cliente existe; senão, pontos', () => {
    const pts = [pt('A', 'c1', 'F1'), pt('A', 'c1', 'F1'), pt('A', 'c1', 'F2'), pt('A', 'c2', 'F3')];
    expect(countClients(pts, true)).toBe(2);
    expect(countClients(pts, false)).toBe(4);
    expect(buildAnnouncement([A], pts, base).items[0].mode).toBe('properties');
    expect(buildAnnouncement([A], pts, { ...base, clientMapped: false }).items[0].mode).toBe('region');
  });

  it('sem coluna de propriedade, cita a região e explica (nada é inventado)', () => {
    const r = buildAnnouncement([B], POINTS, { ...base, propertyMapped: false });
    expect(r.lines).toEqual(['Zona rural de Glória']);
    expect(r.items[0].notes[0]).toMatch(/não tem coluna de propriedade/);
  });

  it('propriedade sem nome no CSV: cita as que têm nome e também a região', () => {
    const pts = [pt('B', 'c4', 'Fazenda Santa Rita'), pt('B', 'c5', '')];
    const r = buildAnnouncement([B], pts, base);
    expect(r.lines).toEqual(['Fazenda Santa Rita', 'Zona rural de Glória']);
    expect(r.items[0].notes[0]).toMatch(/1 ponto\(s\) sem nome de propriedade/);
  });

  it('o operador pode forçar a citação pela região ou pelas propriedades', () => {
    const r = buildAnnouncement([A, B], POINTS, { ...base, overrides: { A: 'properties', B: 'region' } });
    expect(r.lines).toEqual(['Fazenda Boa Vista', 'Sítio Ipê', 'Fazenda Palmares', 'Zona rural de Glória']);
    expect(r.items.every((it) => !it.automatic)).toBe(true);
  });

  it('não repete nomes iguais (ignorando acentos e maiúsculas)', () => {
    const pts = [pt('A', 'c1', 'Sítio Ipê'), pt('B', 'c2', 'SITIO IPE')];
    expect(buildAnnouncement([A, B], pts, base).lines).toEqual(['Sítio Ipê']);
  });

  it('a carta usa as linhas decididas e não tem pendências', () => {
    const r = buildAnnouncement([A, B], POINTS, base);
    const outage = { letterDate: '20 OUTUBRO 2026', letterStart: '08:00h', letterEnd: '12:00h', audience: 'CATAGUASES' };
    const { text } = buildRadioLetterFromLines(r.lines, outage);
    expect(text).toContain('ENDEREÇOS:\nZona rural de Sereno\nFazenda Santa Rita\nSítio do João\n');
    expect(hasPlaceholders(text)).toBe(false);
  });
});

describe('carta sempre gerada: nome automático da área do IBGE', () => {
  const layer = (props) => validateLayer({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { CD_SETOR: 'X', ...props }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
  }, PILOT_CONFIG.layer.fields).layer.features[0].properties;

  it('monta o nome com distrito e situação (configuração do piloto)', () => {
    expect(layer({ NM_DIST: 'Sereno', SITUACAO: 'Rural' }).fallbackName).toBe('Zona rural de Sereno');
    expect(layer({ NM_DIST: 'Sereno', SITUACAO: 'Urbana' }).fallbackName).toBe('Sereno (área urbana)');
    expect(layer({ NM_DIST: '', SITUACAO: 'Rural' }).fallbackName).toBeNull();
  });

  it('nome do operador tem prioridade sobre o nome automático do IBGE', () => {
    expect(resolveSpeakableName(A, {})).toEqual({ name: 'Zona rural de Sereno', origin: 'ibge' });
    const store = renameRegion({}, { code: 'A', name: 'Bela Vista', by: 'Ana' });
    expect(resolveSpeakableName(A, { correspondence: storeToCorrespondence(store) })).toMatchObject({ name: 'Bela Vista', origin: 'operator' });
  });
});
