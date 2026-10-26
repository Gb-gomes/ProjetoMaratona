import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PILOT_CONFIG } from '../../config.js';
import { parseHierarchy } from '../ibgeHierarchy.js';
import { parseCommunityFile, importCommunities } from '../communities.js';
import { createPlaceLocator } from '../placeNames.js';
import { validateLayer } from '../layer.js';
import { spatialJoin } from '../spatialJoin.js';
import { attachPlaces, summarize, auditRows } from '../summary.js';
import { groupByPlace, placeKeyOf, withDistrict } from '../placeRegions.js';
import { resolveSpeakableName } from '../communicationUtils.js';
import { buildAnnouncement } from '../announcement.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const main = read('public/data/ibge/hierarquia_piloto.geojson');
const districts = read('public/data/ibge/distritos_piloto.geojson');
const hierarchy = parseHierarchy({ type: 'FeatureCollection', features: [...main.features, ...districts.features], ufSigla: 'MG' });
const CAT = 'microrregioes_3115300.geojson';
const parsed = parseCommunityFile(read(`public/data/comunidades/${CAT}`), { fileName: CAT, municipalityExists: (c) => hierarchy.byCode.get(c)?.level === 'municipio' });
const mun = hierarchy.byCode.get('3115300');
const { regions } = importCommunities([], parsed, {
  orgId: 'energisa', municipalityGeometry: mun.geometry, municipalityName: mun.name, fileName: CAT, by: 'teste',
});
const locator = createPlaceLocator({ hierarchy, communities: regions });
const { layer } = validateLayer(read('public/data/ibge/camada_piloto.geojson'), PILOT_CONFIG.layer.fields);

// Pontos de teste (não são clientes reais): [lat, lng].
const PTS = [
  [-21.26855, -42.6516], // Joaquim Vieira (ponto do rótulo)
  [-21.26900, -42.6520], // Joaquim Vieira
  [-21.3892, -42.6961], // centro de Cataguases (área urbana)
  [-21.35334, -42.72566], // Alto Belém (centro informado no arquivo)
];
const validation = {
  total: PTS.length,
  records: PTS.map(([lat, lng], i) => ({
    line: i + 2, id: `P${i + 1}`, lat, lng, client: `C${i + 1}`, equipment: null, property: null, status: 'valid', issues: [],
  })),
  warnings: 0,
};
const joined = spatialJoin(validation, layer, { mapping: { client: 1 } });
const placed = attachPlaces(joined, locator);
const grouped = groupByPlace(placed, { locator, sectorLayer: layer });

describe('regiões por microrregião (modo real)', () => {
  it('uma região por microrregião; fora delas, pela área do IBGE', () => {
    expect(joined.matched).toBe(PTS.length);
    expect(grouped.grouping).toBe('place');
    const byName = Object.fromEntries(grouped.units.map((u) => [u.placeName, u]));
    expect(byName['Joaquim Vieira']).toMatchObject({ kind: 'microrregiao', count: 2, externalCode: 'JOAQUIM_VIEIRA', code: '3115300-JOAQUIM_VIEIRA' });
    expect(byName['Área urbana de Cataguases']).toMatchObject({ kind: 'area_ibge', count: 1 });
    expect(grouped.units[0].placeName).toBe('Joaquim Vieira'); // mais pontos primeiro
    expect(grouped.units.map((u) => u.order)).toEqual(grouped.units.map((_, i) => i + 1));
  });

  it('mantém as contagens e guarda o setor censitário de cada ponto', () => {
    expect(grouped.checks.unitSumEqualsMatched).toBe(true);
    expect(summarize(grouped, grouped.units.map((u) => u.id)).consistent).toBe(true);
    grouped.points.forEach((p) => {
      expect(grouped.units.some((u) => u.id === p.unitId)).toBe(true);
      expect(p.sectorCode).toMatch(/^3115300\d+/);
    });
    const jv = grouped.units.find((u) => u.externalCode === 'JOAQUIM_VIEIRA');
    expect(jv.sectors.length).toBeGreaterThan(0);
    expect(grouped.sectorUnits).toBe(placed.units);
  });

  it('cada região tem contorno para o mapa (microrregião ou setores da área)', () => {
    const ids = new Set(grouped.features.map((f) => f.properties.id));
    grouped.units.forEach((u) => expect(ids.has(u.id)).toBe(true));
    const area = grouped.units.find((u) => u.kind === 'area_ibge');
    expect(grouped.features.find((f) => f.properties.id === area.id).geometry.type).toBe('MultiPolygon');
  });

  it('nome no aviso: operador > microrregião / área do IBGE; uma linha por região na carta', () => {
    const jv = grouped.units.find((u) => u.externalCode === 'JOAQUIM_VIEIRA');
    // Carta: comunidade com o distrito, para não confundir comunidades de mesmo nome.
    expect(resolveSpeakableName(jv, {})).toMatchObject({ name: 'Joaquim Vieira (distrito de Glória de Cataguases)', origin: 'microrregiao' });
    expect(jv.distritos.map((d) => d.nome)).toEqual(['Glória de Cataguases']);
    const area = grouped.units.find((u) => u.kind === 'area_ibge');
    expect(resolveSpeakableName(area, {})).toMatchObject({ name: 'Área urbana de Cataguases', origin: 'ibge' });
    const renamed = resolveSpeakableName(jv, { correspondence: { [jv.code]: { name: 'Vila Joaquim', origin: 'operator' } } });
    expect(renamed).toMatchObject({ name: 'Vila Joaquim', origin: 'operator' });

    const ann = buildAnnouncement(grouped.units, grouped.points, {
      nameOf: (u) => resolveSpeakableName(u, {}).name, threshold: 1, clientMapped: true,
    });
    expect(ann.lines).toEqual(grouped.units.map((u) => u.speakName ?? u.placeName));
    expect(ann.pendingUnits).toEqual([]);
  });

  it('auditoria: código do setor, contexto do setor e a região', () => {
    const [header, ...rows] = auditRows(grouped);
    const col = (name) => header.indexOf(name);
    expect(col('regiao')).toBeGreaterThan(-1);
    expect(rows.map((r) => r[col('regiao')])).toEqual(expect.arrayContaining(['Joaquim Vieira', 'Área urbana de Cataguases']));
    expect(rows.every((r) => /^3115300\d+/.test(r[col('codigo_unidade')]))).toBe(true);
  });

  it('sem localizador, demonstração ou sem lugares: resultado inalterado', () => {
    expect(groupByPlace(placed, {})).toBe(placed);
    expect(groupByPlace({ ...placed, source: 'demo' }, { locator, sectorLayer: layer }).grouping).toBeUndefined();
    const noPlace = { ...joined, points: joined.points.map((p) => ({ ...p, place: null })) };
    expect(groupByPlace(noPlace, { locator, sectorLayer: layer })).toBe(noPlace);
    expect(placeKeyOf(null)).toBeNull();
  });
});

describe('comunidade e distrito', () => {
  it('nome com o distrito (um ou mais)', () => {
    expect(withDistrict('Palmeiras', [{ nome: 'Ribeiro Junqueira' }])).toBe('Palmeiras (distrito de Ribeiro Junqueira)');
    expect(withDistrict('Palmeiras', [{ nome: 'Leopoldina' }, { nome: 'Ribeiro Junqueira' }])).toBe('Palmeiras (distritos de Leopoldina e Ribeiro Junqueira)');
    expect(withDistrict('Palmeiras', [])).toBe('Palmeiras');
  });
  it('a mesma comunidade em dois distritos vira duas regiões', () => {
    const place = (cod, nome) => ({ municipio: { cod: '3138401' }, distrito: { cod, nome }, comunidade: { regionId: 'r-palmeiras' } });
    expect(placeKeyOf(place('313840105', 'Leopoldina'))).not.toBe(placeKeyOf(place('313840110', 'Ribeiro Junqueira')));
  });
});
