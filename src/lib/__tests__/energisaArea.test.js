import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseHierarchy } from '../ibgeHierarchy.js';
import { parseCommunityFile, importCommunities } from '../communities.js';
import { createPlaceLocator } from '../placeNames.js';

// Área de concessão da Energisa Minas Rio: 67 municípios (MG e RJ) na base do IBGE e com arquivo de comunidades.
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const main = read('public/data/ibge/hierarquia_piloto.geojson');
const districts = read('public/data/ibge/distritos_piloto.geojson');
const uf = main.features.find((f) => f.properties.level === 'uf');
const hierarchy = parseHierarchy({ type: 'FeatureCollection', features: [...main.features, ...districts.features], ufSigla: uf.properties.sigla });
const manifest = read('public/data/comunidades/index.json');
const lista = readFileSync('scripts/ibge/municipios_energisa_mr.txt', 'utf8').split(/\r?\n/)
  .map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/)[0]);
const exists = (cod) => hierarchy.byCode.get(cod)?.level === 'municipio';

let regions = [];
const reports = manifest.arquivos.map((a) => {
  const parsed = parseCommunityFile(read(`public/data/comunidades/${a.arquivo}`), { fileName: a.arquivo, municipalityExists: exists });
  const mun = hierarchy.byCode.get(parsed.codMun);
  const out = importCommunities(regions, parsed, {
    orgId: 'energisa', municipalityGeometry: mun?.geometry, municipalityName: mun?.name, fileName: a.arquivo, by: 'teste',
  });
  regions = out.regions;
  return { ...out.report, esperado: a.comunidades };
});
const locator = createPlaceLocator({ hierarchy, communities: regions });

describe('área da Energisa Minas Rio', () => {
  it('a base do IBGE e o índice de comunidades cobrem os 67 municípios da lista', () => {
    expect(lista).toHaveLength(67);
    expect(lista.filter((c) => !exists(c))).toEqual([]);
    expect(manifest.arquivos.map((a) => a.codIbgeMun).sort()).toEqual([...lista].sort());
    expect(manifest.arquivos.every((a) => existsSync(`public/data/comunidades/${a.arquivo}`))).toBe(true);
    expect(hierarchy.byLevel.uf.map((u) => u.sigla).sort()).toEqual(['MG', 'RJ']);
    // todo município tem distritos (o serviço de nomes informa o distrito em toda a área)
    expect(lista.filter((c) => !hierarchy.byLevel.distrito.some((d) => d.parentCode === c))).toEqual([]);
  });

  it('importa todas as comunidades, sem inválidas nem recusadas', () => {
    expect(reports.flatMap((r) => r.invalid.map((x) => `${r.codMun} ${x.ref}: ${x.reason}`))).toEqual([]);
    expect(reports.flatMap((r) => r.skipped.map((x) => `${r.codMun} ${x.id}: ${x.reason}`))).toEqual([]);
    expect(reports.filter((r) => r.created.length !== r.esperado).map((r) => r.codMun)).toEqual([]);
    expect(regions).toHaveLength(manifest.arquivos.reduce((s, a) => s + a.comunidades, 0));
  });

  it('rótulo com a UF do próprio município (Nova Friburgo/RJ, Muriaé/MG)', () => {
    const nf = read('public/data/comunidades/microrregioes_3303401.geojson').features[0].properties;
    const p = locator.locate([nf.CENTRO_LON, nf.CENTRO_LAT]);
    expect(p.municipio).toMatchObject({ cod: '3303401', uf: 'RJ' });
    expect(p.comunidade?.id).toBe(nf.ID);
    expect(p.rotulo).toMatch(/Nova Friburgo\/RJ$/);
    const mu = read('public/data/comunidades/microrregioes_3143906.geojson').features[0].properties;
    expect(locator.locate([mu.CENTRO_LON, mu.CENTRO_LAT]).rotulo).toMatch(/Muriaé\/MG$/);
  });
});
