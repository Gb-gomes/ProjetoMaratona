import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHierarchy } from '../ibgeHierarchy.js';
import {
  parseCommunityFile, importCommunities, resolveOverlaps, applyNameCorrections, parseNameCorrections, namesSpreadsheet,
  splitCommunity, parseConfidence, isCommunity, COMMUNITY_SET, slugId,
} from '../communities.js';
import {
  createPlaceLocator, searchPlaces, placeSnapshot, placeChanged,
} from '../placeNames.js';
import {
  intersectGeometries, areaM2, polygonsOf, pointInGeometry,
} from '../geoOps.js';
import { mergeRegions, updateRegion, validateDraft } from '../customRegions.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const main = read('public/data/ibge/hierarquia_piloto.geojson');
const districts = read('public/data/ibge/distritos_piloto.geojson');
const hierarchy = parseHierarchy({ type: 'FeatureCollection', features: [...main.features, ...districts.features], ufSigla: 'MG' });
const CAT = 'microrregioes_3115300.geojson';
const LEO = 'microrregioes_3138401.geojson';
const fileOf = (name) => read(`public/data/comunidades/${name}`);
const ORG = 'energisa';
const exists = (cod) => hierarchy.byCode.get(cod)?.level === 'municipio';

function doImport(regions, name, opts = {}) {
  const parsed = parseCommunityFile(opts.gj ?? fileOf(name), { fileName: name, municipalityExists: exists });
  const mun = hierarchy.byCode.get(parsed.codMun);
  return importCommunities(regions, parsed, {
    orgId: ORG, municipalityGeometry: mun?.geometry, municipalityName: mun?.name, fileName: name, by: 'ana', ...opts,
  });
}

const first = doImport([], CAT);
const both = doImport(first.regions, LEO);
const locator = createPlaceLocator({ hierarchy, communities: both.regions });
const at = (lat, lng) => locator.locate([lng, lat]);

describe('importação do arquivo de comunidades', () => {
  it('cria 42 comunidades ligadas a Cataguases (3115300), com relatório', () => {
    expect(first.report.created).toHaveLength(42);
    expect(first.regions.every((r) => isCommunity(r) && r.ibgeParentCode === '3115300' && r.creationMethod === 'imported')).toBe(true);
    expect(first.report.lowConfidence.map((c) => c.id)).toEqual(expect.arrayContaining(['VARGEM_LINDA', 'PATAGONIA']));
    expect(first.report.invalid).toEqual([]);
    const jv = first.regions.find((r) => r.externalCode === 'JOAQUIM_VIEIRA');
    expect(jv).toMatchObject({
      name: 'Joaquim Vieira', originalName: 'Joaquim Vieira', confidence: 'boa', labelPoint: [-42.6516, -21.26855], regionSet: COMMUNITY_SET,
    });
    // Metadados preservados integralmente; área recalculada (não copiada do arquivo).
    expect(jv.metadata.CONFIRMADO_EM).toMatch(/INCRA/);
    expect(jv.areaKm2).toBeGreaterThan(50);
  });

  it('resolve as sobreposições entre vizinhas (ficam todas sem sobreposição relevante)', () => {
    expect(first.report.overlaps.length).toBeGreaterThan(0);
    const act = first.regions;
    let worst = 0;
    for (let i = 0; i < act.length; i += 1) {
      for (let j = i + 1; j < act.length; j += 1) {
        const g = intersectGeometries(act[i].geometry, act[j].geometry);
        if (g) worst = Math.max(worst, areaM2(g));
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it('regra de sobreposição: confiança "boa" vence; empate, a menor área', () => {
    const sq = (w, e) => ({ type: 'MultiPolygon', coordinates: [[[[w, 0], [e, 0], [e, 1], [w, 1], [w, 0]]]] });
    const items = [{ id: 'A', confidence: 'baixa', geometry: sq(0, 0.6) }, { id: 'B', confidence: 'boa', geometry: sq(0.5, 2) }];
    expect(resolveOverlaps(items)[0].winner).toBe('B');
    const tie = [{ id: 'A', confidence: 'boa', geometry: sq(0, 0.6) }, { id: 'B', confidence: 'boa', geometry: sq(0.5, 2) }];
    expect(resolveOverlaps(tie)[0].winner).toBe('A');
    expect(parseConfidence('baixa: poucos endereços no Censo')).toBe('baixa');
  });

  it('valida o município contra a base IBGE e o formato do arquivo', () => {
    expect(parseCommunityFile({ type: 'FeatureCollection', features: [{ properties: { COD_IBGE_MUN: '9999999', ID: 'X', COMUNIDADE: 'X' } }] }, { municipalityExists: exists }).errors[0])
      .toMatch(/não está na base do IBGE/);
    expect(parseCommunityFile({ type: 'Point' }).errors[0]).toMatch(/FeatureCollection/);
    const gj = fileOf(CAT);
    gj.features[0].geometry = null;
    expect(parseCommunityFile(gj, { municipalityExists: exists }).invalid[0].reason).toMatch(/Geometria/);
  });

  it('reimportar não duplica nem apaga nomes corrigidos manualmente', () => {
    const pil = first.regions.find((r) => r.externalCode === 'PILOES');
    const edited = updateRegion(first.regions, pil.id, { name: 'Pilões' }, {
      regions: first.regions, orgId: ORG, parentGeometry: hierarchy.byCode.get('3115300').geometry,
    }, { by: 'bia' }).regions;
    const again = doImport(edited, CAT);
    expect(again.regions.filter(isCommunity)).toHaveLength(42);
    expect(again.report.created).toHaveLength(0);
    expect(again.report.unchanged).toHaveLength(42);
    expect(again.regions.find((r) => r.externalCode === 'PILOES').name).toBe('Pilões');
    // Mudou o arquivo: atualiza geometria e metadados, mas preserva o nome editado.
    const gj = fileOf(CAT);
    gj.features.find((f) => f.properties.ID === 'PILOES').properties.ENDERECOS_IBGE = 9;
    const changed = doImport(edited, CAT, { gj });
    const p = changed.regions.find((r) => r.externalCode === 'PILOES');
    expect(changed.report.updated).toEqual(['PILOES']);
    expect(changed.report.preserved).toEqual([{ id: 'PILOES', name: 'Pilões', fields: ['nome'] }]);
    expect(p.name).toBe('Pilões');
    expect(p.metadata.ENDERECOS_IBGE).toBe(9);
    expect(p.importVersion).toBe(2);
    // Com "sobrescrever edições", volta o nome do arquivo.
    const over = doImport(edited, CAT, { gj, overwriteEdits: true });
    expect(over.regions.find((r) => r.externalCode === 'PILOES').name).toBe('Piloes');
  });

  it('o mesmo ID em dois municípios gera duas comunidades distintas', () => {
    const vl = both.regions.filter((r) => r.externalCode === 'VARGEM_LINDA');
    expect(vl).toHaveLength(2);
    expect(new Set(vl.map((r) => r.ibgeParentCode))).toEqual(new Set(['3115300', '3138401']));
    expect(both.report.created).toHaveLength(76);
  });
});

describe('serviço coordenada → nome', () => {
  it('(-21.39002, -42.75969) → Goiabal', () => {
    const p = at(-21.39002, -42.75969);
    expect(p.comunidade.nome).toBe('Goiabal');
    expect(p.origem_nome).toBe('comunidade');
    expect(p.municipio).toEqual({ cod: '3115300', nome: 'Cataguases', uf: 'MG' });
  });

  it('(-21.26855, -42.65160) → Joaquim Vieira; o distrito vem do IBGE', () => {
    const p = at(-21.26855, -42.6516);
    expect(p.comunidade.nome).toBe('Joaquim Vieira');
    // A comunidade toca 4 distritos; este ponto fica em Glória de Cataguases
    // (conferido também pelo setor censitário 311530012000002).
    expect(p.distrito.nome).toBe('Glória de Cataguases');
    expect(p.rotulo).toBe('Comunidade Joaquim Vieira · Distrito de Glória de Cataguases · Cataguases/MG');
    // No distrito-sede, o rótulo indica a sede.
    expect(at(-21.39002, -42.75969).rotulo).toBe('Comunidade Goiabal · Distrito-sede (Cataguases) · Cataguases/MG');
  });

  it('centro da cidade → sem comunidade, "Área urbana de Cataguases"', () => {
    const p = at(-21.3893, -42.6964);
    expect(p.comunidade).toBeNull();
    expect(p.origem_nome).toBe('ibge');
    expect(p.rotulo).toBe('Área urbana de Cataguases');
    expect(p.distrito.sede).toBe(true);
  });

  it('lacuna pequena entre comunidades → a mais próxima ("comunidade_proxima")', () => {
    // Procura um ponto fora de todas as comunidades, mas a poucos metros de uma.
    const cat = both.regions.filter((r) => r.ibgeParentCode === '3115300');
    let found = null;
    outer: for (const r of cat) {
      for (const poly of polygonsOf(r.geometry)) {
        for (let k = 0; k < poly[0].length; k += 7) {
          for (const [dx, dy] of [[0.0003, 0], [-0.0003, 0], [0, 0.0003], [0, -0.0003]]) {
            const q = [poly[0][k][0] + dx, poly[0][k][1] + dy];
            const inside = cat.some((c) => pointInGeometry(q, c.geometry));
            const inMun = pointInGeometry(q, hierarchy.byCode.get('3115300').geometry);
            if (!inside && inMun) { found = q; break outer; }
          }
        }
      }
    }
    expect(found).not.toBeNull();
    const p = locator.locate(found);
    expect(p.origem_nome).toBe('comunidade_proxima');
    expect(p.comunidade).not.toBeNull();
  });

  it('comunidade de confiança baixa vem marcada como aproximada', () => {
    const vl = both.regions.find((r) => r.externalCode === 'VARGEM_LINDA' && r.ibgeParentCode === '3115300');
    const p = locator.locate(vl.labelPoint);
    expect(p.comunidade).toMatchObject({ nome: 'Vargem Linda', confianca: 'baixa', aproximada: true });
  });

  it('município sem arquivo de comunidades usa só nomes do IBGE', () => {
    const arg = hierarchy.byCode.get('3104403'); // Argirita
    const p = locator.locate(arg.labelAt);
    expect(p.comunidade).toBeNull();
    expect(p.municipio.nome).toBe('Argirita');
    expect(p.rotulo).toMatch(/Argirita\/MG$/);
    expect(locator.hasCommunities('3104403')).toBe(false);
  });

  it('retrato para cadastro e detecção de mudança', () => {
    const a = placeSnapshot(at(-21.39002, -42.75969));
    expect(a).toMatchObject({ municipioCod: '3115300', comunidadeId: 'GOIABAL', comunidade: 'Goiabal' });
    expect(placeChanged(a, placeSnapshot(at(-21.26855, -42.6516)))).toBe(true);
    expect(placeChanged(a, placeSnapshot(at(-21.39002, -42.75969)))).toBe(false);
  });
});

describe('nomes, busca e edição', () => {
  it('planilha COD_IBGE_MUN;ID;nome_exibicao corrige vários nomes e a busca ignora acentos', () => {
    const rows = parseNameCorrections('COD_IBGE_MUN;ID;nome_exibicao\n3115300;SAO_DINIZ;São Diniz\n3115300;HUMAITA;Humaitá\n3115300;NAO_EXISTE;X\n');
    const { regions, report } = applyNameCorrections(both.regions, rows, { by: 'ana' });
    expect(report.changed.map((c) => c.name)).toEqual(['São Diniz', 'Humaitá']);
    expect(report.notFound).toHaveLength(1);
    const sd = regions.find((r) => r.externalCode === 'SAO_DINIZ');
    expect(sd.nameEdited).toBe(true);
    expect(searchPlaces('sao diniz', { hierarchy, communities: regions })[0]).toMatchObject({ kind: 'comunidade', nome: 'São Diniz' });
    expect(searchPlaces('SERENO', { hierarchy, communities: regions })[0].kind).toBe('distrito');
    expect(namesSpreadsheet(regions, '3115300')).toMatch(/3115300;SAO_DINIZ;São Diniz/);
  });

  it('dividir: a parte vira comunidade nova; a original fica com o resto', () => {
    const goi = both.regions.find((r) => r.externalCode === 'GOIABAL');
    const [lng, lat] = goi.labelPoint;
    const part = { type: 'Polygon', coordinates: [[[lng - 0.01, lat - 0.01], [lng + 0.01, lat - 0.01], [lng + 0.01, lat + 0.01], [lng - 0.01, lat + 0.01], [lng - 0.01, lat - 0.01]]] };
    // Validação da parte: a sobreposição com a própria original é ignorada.
    const v = validateDraft({
      name: 'Goiabal de Cima', geometry: part, ibgeParentCode: '3115300', regionSet: COMMUNITY_SET,
    }, {
      regions: both.regions, orgId: ORG, parentGeometry: goi.geometry, ignoreOverlapIds: [goi.id],
    });
    expect(v.ok).toBe(true);
    const { regions, created, reduced } = splitCommunity(both.regions, goi.id, { part: v.prepared.geometry, name: 'Goiabal de Cima', by: 'ana' });
    expect(created.externalCode).toBe(slugId('Goiabal de Cima'));
    expect(reduced.areaKm2 + created.areaKm2).toBeCloseTo(goi.areaKm2, 2);
    expect(reduced.history.at(-1).changes.geometry.previousGeometry).toEqual(goi.geometry);
    const loc = createPlaceLocator({ hierarchy, communities: regions });
    expect(loc.locate([lng, lat]).comunidade.nome).toBe('Goiabal de Cima');
    // Reimportar não desfaz a divisão (contorno editado é preservado).
    const re = doImport(regions, CAT);
    expect(re.regions.find((r) => r.id === goi.id).geometry).toEqual(reduced.geometry);
  });

  it('unir duas comunidades vizinhas', () => {
    const a = both.regions.find((r) => r.externalCode === 'PRAINHA');
    const b = both.regions.find((r) => r.externalCode === 'SINIMBU' && r.ibgeParentCode === '3115300');
    const merged = mergeRegions(both.regions, a.id, b.id, { by: 'ana' });
    const keep = merged.find((r) => r.id === a.id);
    expect(keep.areaKm2).toBeCloseTo(a.areaKm2 + b.areaKm2, 2);
    expect(merged.find((r) => r.id === b.id).deletedAt).toBeTruthy();
    expect(keep.geometryEdited).toBe(true);
  });
});
