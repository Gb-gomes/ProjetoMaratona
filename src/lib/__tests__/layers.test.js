import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import { strToU8 } from 'fflate';
import {
  crsFromPrj, crsFromGeoJSON, makeTransform, transformGeometry, looksProjected,
} from '../layers/crs.js';
import {
  readGeoJSON, repairGeometry, normalizeFeatures, readCsv, readSource, detectKind, ringSelfIntersects, inventoryAttributes,
} from '../layers/importEngine.js';
import { readDbf } from '../layers/dbf.js';
import {
  buildIndex, packTile, hitTest, featureBoxes, summarizeInside, filterInside, fieldStats, lngLatToWorld,
} from '../layers/dataEngine.js';
import {
  compileStyle, legendFor, categorizedRule, graduatedRule, canViewLayer, canEditLayer, can, buildTree, flattenLayers, paneZIndexes,
  reorderSiblings, siblingsOfNode,
} from '../layers/layerModel.js';
import {
  loadLayerState, saveLayerState, effectiveLayer, patchLayer, EMPTY_LAYER_STATE,
} from '../layers/userLayerState.js';
import { createMemoryStorage } from '../priorityRepository.js';
import {
  writeFeatures, readFeatures, deleteVersion, putLayer, getAllLayers, deleteLayerData, CHUNK_SIZE,
} from '../layers/layerStore.js';
import { createLocalRegionRepository } from '../customRegionRepository.js';

const UTM23S_PRJ = 'PROJCS["SIRGAS_2000_UTM_Zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const SIRGAS_GEO_PRJ = 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const pt = (x, y, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties });
const line = (coords, properties = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties });
const square = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

describe('referencial (CRS)', () => {
  it('identifica SIRGAS 2000 / UTM 23S e SIRGAS geográfico pelo .prj', () => {
    expect(crsFromPrj(UTM23S_PRJ).code).toBe('EPSG:31983');
    expect(crsFromPrj(SIRGAS_GEO_PRJ).code).toBe('EPSG:4674');
    expect(crsFromPrj('PROJCS["WGS_1984_UTM_Zone_24S",GEOGCS["GCS_WGS_1984"]]').code).toBe('EPSG:32724');
  });

  it('referencial não catalogado mantém o nome declarado', () => {
    const c = crsFromPrj('PROJCS["Algum_Local",GEOGCS["X"]]');
    expect(c.code).toBeNull();
    expect(c.declared).toBe('Algum_Local');
  });

  it('lê o membro "crs" de GeoJSON antigo', () => {
    expect(crsFromGeoJSON({ crs: { properties: { name: 'urn:ogc:def:crs:EPSG::31983' } } }).code).toBe('EPSG:31983');
    expect(crsFromGeoJSON({ crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } }).code).toBe('EPSG:4326');
  });

  it('reprojeta UTM 23S para graus com precisão sub-métrica', () => {
    const lnglat = [-42.69, -21.39];
    const utm = proj4('EPSG:4326', '+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs').forward(lnglat);
    const g = transformGeometry({ type: 'Point', coordinates: [...utm] }, makeTransform(crsFromPrj(UTM23S_PRJ)));
    expect(g.coordinates[0]).toBeCloseTo(lnglat[0], 6);
    expect(g.coordinates[1]).toBeCloseTo(lnglat[1], 6);
    expect(looksProjected([utm])).toBe(true);
  });
});

describe('leitura e correção de geometrias', () => {
  it('aceita FeatureCollection, Feature e geometria solta', () => {
    expect(readGeoJSON({ type: 'FeatureCollection', features: [pt(0, 0)] }).features).toHaveLength(1);
    expect(readGeoJSON(JSON.stringify(pt(1, 1))).features).toHaveLength(1);
    expect(readGeoJSON({ type: 'Point', coordinates: [1, 2] }).features[0].geometry.type).toBe('Point');
    expect(() => readGeoJSON('{nao json')).toThrow(/JSON válido/);
  });

  it('fecha anéis, remove vértices repetidos e rejeita o que não tem conserto', () => {
    const open = repairGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 0], [1, 1], [0, 1]]] });
    expect(open.fixed).toBeTruthy();
    expect(open.geometry.coordinates[0].at(-1)).toEqual([0, 0]);
    expect(repairGeometry({ type: 'LineString', coordinates: [[1, 1], [1, 1]] }).reason).toMatch(/menos de 2/);
    expect(repairGeometry(null).reason).toMatch(/ausente/);
    expect(repairGeometry({ type: 'Point', coordinates: [NaN, 1] }).reason).toMatch(/inválida/);
    expect(repairGeometry({ type: 'GeometryCollection', geometries: [] }).reason).toMatch(/GeometryCollection/);
  });

  it('corrige autointerseção (equivalente ao ST_MakeValid)', () => {
    const bow = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
    expect(ringSelfIntersects(bow)).toBe(true);
    const r = repairGeometry({ type: 'Polygon', coordinates: [bow] });
    expect(r.fixed).toMatch(/autointerseção/);
    expect(r.geometry.type).toBe('MultiPolygon');
  });

  it('detecta autointerseção também em anéis grandes', () => {
    const ring = Array.from({ length: 600 }, (_, i) => [Math.cos((i / 600) * 2 * Math.PI), Math.sin((i / 600) * 2 * Math.PI)]);
    ring.push(ring[0]);
    expect(ringSelfIntersects(ring)).toBe(false);
    ring[300] = [2, 0];
    ring[10] = [-2, 0.05];
    expect(ringSelfIntersects(ring)).toBe(true);
  });

  it('normaliza: reprojeta, conta por tipo e gera o relatório de rejeitadas', () => {
    const toUtm = proj4('EPSG:4326', '+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs');
    const features = [pt(...toUtm.forward([-42.7, -21.4])), pt(...toUtm.forward([-42.6, -21.3])), { type: 'Feature', geometry: null, properties: {} }];
    const out = normalizeFeatures(features, { crs: crsFromPrj(UTM23S_PRJ) });
    expect(out.stats.accepted).toBe(2);
    expect(out.rejected).toEqual([{ index: 2, ref: 'feição 3', reason: 'Geometria ausente' }]);
    expect(out.stats.bbox[0]).toBeCloseTo(-42.7, 5);
    // Coordenadas métricas tratadas como graus: fora da faixa → rejeitadas.
    expect(normalizeFeatures([pt(700000, 7600000)], { crs: null }).rejected[0].reason).toMatch(/fora da faixa/);
  });

  it('CSV com E/N em UTM e vírgula decimal; o referencial precisa ser confirmado', () => {
    const csv = strToU8('﻿codigo;leste;norte\nA;738473,38;7634050,21\nB;;\n');
    const r = readCsv(csv, {});
    expect(r.suggestion).toEqual({ x: 1, y: 2 });
    expect(r.features[0].geometry.coordinates).toEqual([738473.38, 7634050.21]);
    expect(r.features[1].geometry).toBeNull();
    const src = readSource({ kind: 'csv', bytes: csv });
    expect(src.needsCrs).toBe(true);
    const chosen = readSource({ kind: 'csv', bytes: csv, options: { crsCode: 'EPSG:31983' } });
    expect(chosen.needsCrs).toBe(false);
  });

  it('GeoJSON sem "crs" é WGS 84; GeoPackage recebe orientação clara', () => {
    expect(readSource({ kind: 'geojson', geojson: { type: 'FeatureCollection', features: [pt(-42, -21)] } }).crs.code).toBe('EPSG:4326');
    expect(readSource({ kind: 'geojson', geojson: { type: 'FeatureCollection', features: [pt(700000, 7600000)] } }).needsCrs).toBe(true);
    expect(() => readSource({ kind: 'gpkg' })).toThrow(/GeoPackage/);
    expect(detectKind('rede.KMZ')).toBe('kmz');
    expect(detectKind('rede.zip')).toBe('shapefile');
  });

  it('inventaria os atributos com tipo e exemplos', () => {
    const inv = inventoryAttributes([pt(0, 0, { TENSAO: '13.8 kV', N: 3 }), pt(0, 0, { TENSAO: '0.22 kV', N: '4,5' })]);
    expect(inv.find((a) => a.name === 'N').type).toBe('number');
    expect(inv.find((a) => a.name === 'TENSAO').samples).toEqual(['13.8 kV', '0.22 kV']);
  });
});

/** Monta um .dbf mínimo (campos C e N). */
function makeDbf(fields, rows, encode = (s) => strToU8(s)) {
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const headLen = 32 + fields.length * 32 + 1;
  const buf = new Uint8Array(headLen + rows.length * recLen + 1);
  const v = new DataView(buf.buffer);
  buf[0] = 3;
  v.setUint32(4, rows.length, true);
  v.setUint16(8, headLen, true);
  v.setUint16(10, recLen, true);
  fields.forEach((f, i) => {
    buf.set(strToU8(f.name), 32 + i * 32);
    buf[32 + i * 32 + 11] = f.type.charCodeAt(0);
    buf[32 + i * 32 + 16] = f.len;
  });
  buf[headLen - 1] = 0x0d;
  rows.forEach((row, r) => {
    let o = headLen + r * recLen + 1;
    fields.forEach((f) => {
      const bytes = encode(String(row[f.name] ?? ''));
      const cell = new Uint8Array(f.len).fill(0x20);
      cell.set(bytes.slice(0, f.len), f.type === 'N' ? Math.max(0, f.len - bytes.length) : 0);
      buf.set(cell, o);
      o += f.len;
    });
  });
  return buf;
}

describe('leitor de .dbf', () => {
  const fields = [{ name: 'NOME', type: 'C', len: 12 }, { name: 'ALTURA', type: 'N', len: 6 }];
  it('lê texto e números; vazio vira null', () => {
    const { rows } = readDbf(makeDbf(fields, [{ NOME: 'Poste A', ALTURA: '10.5' }, { NOME: '', ALTURA: '' }]), 'UTF-8');
    expect(rows).toEqual([{ NOME: 'Poste A', ALTURA: 10.5 }, { NOME: null, ALTURA: null }]);
  });

  it('sem .cpg, detecta Windows-1252 (comum em shapefiles brasileiros)', () => {
    const latin1 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
    const { rows, encoding } = readDbf(makeDbf(fields, [{ NOME: 'São João', ALTURA: '9' }], latin1));
    expect(encoding).toBe('windows-1252');
    expect(rows[0].NOME).toBe('São João');
  });

  it('sem .cpg, mantém UTF-8 quando o arquivo é UTF-8 válido', () => {
    const { rows, encoding } = readDbf(makeDbf(fields, [{ NOME: 'Leopoldina', ALTURA: '1' }, { NOME: 'Ação', ALTURA: '2' }]));
    expect(encoding).toBe('utf-8');
    expect(rows[1].NOME).toBe('Ação');
  });
});

describe('motor de tiles, cliques e resumos', () => {
  // Grade de 100 x 100 pontos em ~1 km² e duas linhas.
  const points = [];
  for (let i = 0; i < 100; i += 1) for (let j = 0; j < 100; j += 1) points.push(pt(-42.70 + i * 0.0001, -21.40 + j * 0.0001, { id: i * 100 + j, tipo: i % 2 ? 'A' : 'B' }));
  const lines = [line([[-42.705, -21.395], [-42.685, -21.395]], { tensao: '13.8 kV' }), line([[-42.60, -21.30], [-42.59, -21.30]], { tensao: '0.22 kV' })];
  const features = [...points, ...lines];
  const index = buildIndex(features);
  const boxes = featureBoxes(features);

  const tileAt = (lng, lat, z) => {
    const [wx, wy] = lngLatToWorld(lng, lat, z);
    return [Math.floor(wx / 256), Math.floor(wy / 256)];
  };

  it('tiles em zoom alto trazem todos os pontos; em zoom baixo, no máximo um por pixel', () => {
    const [x17, y17] = tileAt(-42.695, -21.395, 17);
    const high = packTile(index, features, 17, x17, y17, { fields: ['tipo'] });
    // Sem rarefação no zoom 17: todos os pontos da área do tile (com a margem de 4 px).
    const expected = points.filter(({ geometry: { coordinates: [lng, lat] } }) => {
      const [wx, wy] = lngLatToWorld(lng, lat, 17);
      return wx >= x17 * 256 - 4 && wx <= (x17 + 1) * 256 + 4 && wy >= y17 * 256 - 4 && wy <= (y17 + 1) * 256 + 4;
    }).length;
    expect(expected).toBeGreaterThan(500);
    expect([...high.types].filter((t) => t === 1).length).toBe(expected);
    expect(high.values.tipo).toHaveLength(high.n);
    const [x9, y9] = tileAt(-42.695, -21.395, 9);
    const low = packTile(index, features, 9, x9, y9);
    const lowPoints = [...low.types].filter((t) => t === 1).length;
    // A grade (~1 km) ocupa uns 5 x 5 pixels no zoom 9: no máximo um ponto por pixel, dos 10.000.
    expect(lowPoints).toBeLessThanOrEqual(36);
    expect([...low.types]).toContain(2); // a linha continua presente
  });

  it('acima do zoom máximo do índice, o tile ancestral é ampliado', () => {
    const [x, y] = tileAt(-42.695, -21.395, 19);
    expect(packTile(index, features, 19, x, y).n).toBeGreaterThan(0);
  });

  it('clique encontra o ponto (com atributos) e a linha', () => {
    const p = points[4242].geometry.coordinates;
    expect(hitTest(index, features, { lng: p[0], lat: p[1], zoom: 18 }).properties.id).toBe(4242);
    expect(hitTest(index, features, { lng: -42.595, lat: -21.30001, zoom: 16 }).properties.tensao).toBe('0.22 kV');
    expect(hitTest(index, features, { lng: -42.5, lat: -21.2, zoom: 16 })).toBeNull();
  });

  it('resumo dentro do polígono: contagem de pontos e km de linha (geodésico)', () => {
    // Bordas entre as colunas/linhas da grade: 51 colunas × 100 linhas.
    const poly = square(-42.70005, -21.40005, -42.69495, -21.39005);
    const s = summarizeInside(features, boxes, poly);
    expect(s.points).toBe(51 * 100);
    // A linha cruza 0,0051° de longitude (≈ 528 m nessa latitude).
    expect(s.lineMeters).toBeGreaterThan(500);
    expect(s.lineMeters).toBeLessThan(540);
    expect(s.lineFeatures).toBe(1);
  });

  it('filtro "só dentro da sub-região" e estatística de campo', () => {
    const poly = square(-42.71, -21.41, -42.69, -21.39);
    const idx = filterInside(features, boxes, poly);
    expect(idx).toHaveLength(points.length + 1);
    const st = fieldStats(features, 'tipo');
    expect(st.values.find((v) => v.value === 'A').count).toBe(5000);
  });
});

describe('estilo, legenda e permissões', () => {
  it('estilo categorizado e graduado por atributo', () => {
    const cat = compileStyle({ color: '#000000', rule: categorizedRule('tensao', [{ value: '13.8 kV', count: 5 }, { value: '0.22 kV', count: 9 }]) });
    expect(cat({ tensao: '0.22 kV' }).color).not.toBe(cat({ tensao: '13.8 kV' }).color);
    expect(cat({ tensao: 'outra' }).color).toBe('#94A3B8');
    const grad = compileStyle({ rule: graduatedRule('altura', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
    expect(grad({ altura: 1 }).color).not.toBe(grad({ altura: 10 }).color);
    expect(grad({ altura: 'x' }).color).toBe('#94A3B8');
  });

  it('a legenda reflete as classes do estilo', () => {
    const style = { color: '#111111', rule: categorizedRule('tensao', [{ value: '13.8 kV', count: 2 }]) };
    const lg = legendFor(style, 'line');
    expect(lg.title).toBe('tensao');
    expect(lg.items[0]).toMatchObject({ geometryType: 'line', label: '13.8 kV (2)' });
    expect(legendFor({ color: '#123456' }, 'point').items).toHaveLength(1);
  });

  it('organização não vê camada privada nem de organização de outra; vê pública e compartilhada', () => {
    const base = { orgId: 'energisa', createdBy: 'ana@x' };
    const outra = { orgId: 'outra', userId: 'bia@y' };
    expect(canViewLayer({ ...base, visibility: 'private' }, outra)).toBe(false);
    expect(canViewLayer({ ...base, visibility: 'organization' }, outra)).toBe(false);
    expect(canViewLayer({ ...base, visibility: 'public' }, outra)).toBe(true);
    expect(canViewLayer({ ...base, visibility: 'shared', shares: [{ orgId: 'outra', permission: 'view' }] }, outra)).toBe(true);
    expect(canViewLayer({ ...base, visibility: 'private' }, { orgId: 'energisa', userId: 'caio@x' })).toBe(false);
    expect(canViewLayer({ ...base, visibility: 'private' }, { orgId: 'energisa', userId: 'ana@x' })).toBe(true);
    expect(canViewLayer({ orgId: null, kind: 'ibge' }, outra)).toBe(true);
  });

  it('camadas IBGE são imutáveis; visualizador não edita', () => {
    expect(canEditLayer({ orgId: null, kind: 'ibge' }, { orgId: 'energisa', role: 'admin' })).toBe(false);
    expect(canEditLayer({ orgId: 'energisa', kind: 'data', visibility: 'organization' }, { orgId: 'energisa', role: 'viewer' })).toBe(false);
    expect(canEditLayer({ orgId: 'energisa', kind: 'data', visibility: 'organization' }, { orgId: 'energisa', role: 'editor' })).toBe(true);
    expect(can('viewer', 'edit-region')).toBe(false);
    expect(can('admin', 'manage-org')).toBe(true);
  });
});

describe('árvore e ordem das camadas', () => {
  const groups = [{ id: 'g1', name: 'Operação', sortOrder: 3 }, { id: 'g2', name: 'Energisa', sortOrder: 2 }, { id: 'g3', name: 'Rede', parentGroupId: 'g2', sortOrder: 1 }];
  const layers = [{ id: 'a', groupId: 'g1', defaultOrder: 2 }, { id: 'b', groupId: 'g1', defaultOrder: 1 }, { id: 'c', groupId: 'g3' }, { id: 'd', groupId: 'g3' }];

  it('o que está mais acima no painel fica mais acima no mapa', () => {
    const order = flattenLayers(buildTree(groups, layers, {})).map((l) => l.id);
    expect(order.slice(0, 2)).toEqual(['a', 'b']);
    const z = paneZIndexes(flattenLayers(buildTree(groups, layers, {})));
    expect(z.a).toBeGreaterThan(z.b);
    expect(z.b).toBeGreaterThan(z.c);
  });

  it('reordenar entre irmãos muda só a ordem daquele grupo', () => {
    const tree = buildTree(groups, layers, {});
    const sib = siblingsOfNode(tree, 'b');
    const order = reorderSiblings({}, sib, 'b', 0);
    expect(flattenLayers(buildTree(groups, layers, { order })).map((l) => l.id).slice(0, 2)).toEqual(['b', 'a']);
    // Grupos também são reordenáveis.
    const gOrder = reorderSiblings({}, siblingsOfNode(tree, 'g2'), 'g2', 0);
    expect(flattenLayers(buildTree(groups, layers, { order: gOrder }))[0].id).toBe('c');
  });

  it('estado por usuário: salvar e recarregar', () => {
    const storage = createMemoryStorage();
    let st = patchLayer(EMPTY_LAYER_STATE, 'c', { visible: true, opacity: 0.4 });
    st = { ...st, basemap: 'basemap:satellite' };
    expect(saveLayerState('ana@x', st, storage)).toBe(true);
    const back = loadLayerState('ana@x', storage);
    expect(effectiveLayer(back, { id: 'c' })).toEqual({ visible: true, opacity: 0.4, filterRegionId: null });
    expect(back.basemap).toBe('basemap:satellite');
    expect(loadLayerState('outro@x', storage)).toEqual(EMPTY_LAYER_STATE);
    expect(effectiveLayer(back, { id: 'z', defaultVisible: true }).visible).toBe(true);
  });
});

describe('armazenamento local (IndexedDB)', () => {
  it('grava versões em blocos, lê e apaga uma versão antiga', async () => {
    const many = Array.from({ length: CHUNK_SIZE * 2 + 7 }, (_, i) => pt(i * 1e-5, 0, { i }));
    await writeFeatures('L1', 1, many);
    await writeFeatures('L1', 2, many.slice(0, 3));
    expect(await readFeatures('L1', 1)).toHaveLength(many.length);
    expect((await readFeatures('L1', 1))[CHUNK_SIZE + 1].properties.i).toBe(CHUNK_SIZE + 1);
    await deleteVersion('L1', 1);
    expect(await readFeatures('L1', 1)).toHaveLength(0);
    expect(await readFeatures('L1', 2)).toHaveLength(3);
    await putLayer({ id: 'L1', orgId: 'energisa', name: 'x' });
    await deleteLayerData('L1');
    expect(await readFeatures('L1', 2)).toHaveLength(0);
    expect((await getAllLayers()).find((l) => l.id === 'L1')).toBeUndefined();
  });

  it('sub-regiões: grava só as alteradas e separa por organização', async () => {
    const a = createLocalRegionRepository({ orgId: 'energisa' });
    const b = createLocalRegionRepository({ orgId: 'outra' });
    const r1 = { id: 'r1', orgId: 'energisa', name: 'Norte' };
    await a.saveRegions([r1], []);
    await b.saveRegions([{ id: 'r9', orgId: 'outra', name: 'Sul' }], []);
    expect((await a.loadRegions()).map((r) => r.id)).toEqual(['r1']);
    await a.saveSettings({ allowSiblingOverlap: true });
    expect(await a.loadSettings()).toEqual({ allowSiblingOverlap: true });
    expect(await b.loadSettings()).toBeNull();
  });
});
