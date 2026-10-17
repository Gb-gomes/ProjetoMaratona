import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  microregionDrafts, pendingDrafts, createMicroregion, microregionLayer, locateMicroregion, parseLatLng, isMicroregion, MICROREGION_TAG,
} from '../microregions.js';
import { findOverlaps, siblingsOf, softDeleteRegion, DEFAULT_RULES } from '../customRegions.js';
import { spatialJoin } from '../spatialJoin.js';

const hierarchy = JSON.parse(readFileSync('public/data/ibge/hierarquia_piloto.geojson', 'utf8'));
const mun = (code) => hierarchy.features.find((f) => f.properties.code === code);
const MUNS = [
  { code: '3115300', name: 'Cataguases' },
  { code: '3138401', name: 'Leopoldina' },
];
const municipalities = hierarchy.features.filter((f) => f.properties.level === 'municipio')
  .map((f) => ({ code: f.properties.code, name: f.properties.name, geometry: f.geometry }));
const ORG = 'energisa';

/** Carrega as microrregiões reais dos dois municípios, como o app faz na primeira abertura. */
function seedAll(start = []) {
  let regions = start;
  const failed = [];
  MUNS.forEach((m) => {
    const gj = JSON.parse(readFileSync(`public/data/microrregioes/microrregioes_${m.code}.geojson`, 'utf8'));
    const drafts = pendingDrafts(regions, microregionDrafts(gj, { municipalityCode: m.code, municipalityName: m.name, sourceFile: 'x.geojson' }));
    drafts.forEach((d) => {
      try {
        regions = createMicroregion(regions, d, { orgId: ORG, parentGeometry: mun(m.code).geometry, rules: DEFAULT_RULES }, { by: 'teste', at: '2026-10-17T00:00:00Z' }).regions;
      } catch (err) {
        failed.push(`${d.name}: ${err.message}`);
      }
    });
  });
  return { regions, failed };
}

describe('parseLatLng', () => {
  it('aceita vírgula ou ponto decimal, em um ou dois campos', () => {
    expect(parseLatLng('-21,49', '-42,55')).toEqual({ lat: -21.49, lng: -42.55 });
    expect(parseLatLng('-21.49, -42.55')).toEqual({ lat: -21.49, lng: -42.55 });
    expect(parseLatLng('-21,49 -42,55')).toEqual({ lat: -21.49, lng: -42.55 });
    expect(parseLatLng('-21,49; -42,55')).toEqual({ lat: -21.49, lng: -42.55 });
    expect(parseLatLng('-21.49,-42.55')).toEqual({ lat: -21.49, lng: -42.55 });
  });

  it('recusa texto, um número só e coordenada fora do Brasil (invertida)', () => {
    expect(parseLatLng('abc', 'def').error).toBeTruthy();
    expect(parseLatLng('-21.49').error).toBeTruthy();
    expect(parseLatLng('-42.55', '-21.49').error).toMatch(/invertidas/);
  });
});

describe('microrregiões reais (Cataguases e Leopoldina)', () => {
  let seeded;
  beforeAll(() => { seeded = seedAll(); });

  it('carrega todas como sub-regiões, sem sobreposição entre irmãs', () => {
    expect(seeded.failed).toEqual([]);
    const micro = seeded.regions.filter(isMicroregion);
    expect(micro.length).toBe(42 + 76);
    expect(micro.every((r) => r.tags.includes(MICROREGION_TAG) && r.creationMethod === 'imported')).toBe(true);
    const leop = micro.filter((r) => r.ibgeParentCode === '3138401');
    const sample = leop.slice(0, 10);
    sample.forEach((r) => {
      const sib = siblingsOf(seeded.regions, r, r.id);
      expect(findOverlaps(r.geometry, sib, DEFAULT_RULES)).toEqual([]);
    });
  }, 120000);

  it('Palmeiras (Leopoldina) tem a área esperada e o ponto -21,49 / -42,55 cai nela', () => {
    const palmeiras = seeded.regions.find((r) => r.name === 'Palmeiras');
    expect(palmeiras.ibgeParentCode).toBe('3138401');
    expect(palmeiras.areaKm2).toBeGreaterThan(35);
    expect(palmeiras.areaKm2).toBeLessThan(38);
    const loc = locateMicroregion(-21.49, -42.55, seeded.regions, municipalities);
    expect(loc.microregions.map((r) => r.name)).toEqual(['Palmeiras']);
    expect(loc.municipality.name).toBe('Leopoldina');
  });

  it('ponto na área urbana de Cataguases: município conhecido, sem microrregião', () => {
    const loc = locateMicroregion(-21.3894, -42.6897, seeded.regions, municipalities);
    expect(loc.microregions).toEqual([]);
    expect(loc.municipality.name).toBe('Cataguases');
  });

  it('é idempotente e não recria microrregião excluída pela organização', () => {
    const again = seedAll(seeded.regions);
    expect(again.regions.length).toBe(seeded.regions.length);
    const palmeiras = seeded.regions.find((r) => r.name === 'Palmeiras');
    const afterDelete = softDeleteRegion(seeded.regions, palmeiras.id, { by: 'teste' }).regions;
    const third = seedAll(afterDelete);
    expect(third.regions.length).toBe(afterDelete.length);
    expect(microregionLayer(third.regions).features.some((f) => f.properties.name === 'Palmeiras')).toBe(false);
  });

  it('desconta sub-região já desenhada pela organização no mesmo município', () => {
    const drawn = {
      id: 'manual', orgId: ORG, name: 'Área desenhada', tags: [], ibgeParentCode: '3138401', parentCustomRegionId: null,
      geometry: {
        type: 'Polygon', coordinates: [[[-42.56, -21.50], [-42.54, -21.50], [-42.54, -21.48], [-42.56, -21.48], [-42.56, -21.50]]],
      },
      deletedAt: null,
    };
    const gj = JSON.parse(readFileSync('public/data/microrregioes/microrregioes_3138401.geojson', 'utf8'));
    const d = microregionDrafts(gj, { municipalityCode: '3138401', municipalityName: 'Leopoldina' }).find((x) => x.name === 'Palmeiras');
    const { region } = createMicroregion([drawn], d, { orgId: ORG, parentGeometry: mun('3138401').geometry, rules: DEFAULT_RULES }, { by: 'teste' });
    expect(findOverlaps(region.geometry, [drawn], DEFAULT_RULES)).toEqual([]);
    expect(region.areaKm2).toBeLessThan(36);
  });

  it('serve de camada para o cruzamento dos pontos (carta usa o nome da microrregião)', () => {
    const layer = microregionLayer(seeded.regions, { municipalityName: (c) => MUNS.find((m) => m.code === c)?.name ?? c });
    expect(layer.features.length).toBe(118);
    const records = [
      { line: 2, lat: -21.49, lng: -42.55, client: 'A', property: 'Faz. 1', status: 'valid', issues: [] },
      { line: 3, lat: -21.4917, lng: -42.5475, client: 'B', property: 'Faz. 2', status: 'valid', issues: [] },
    ];
    const joined = spatialJoin({ records, total: 2 }, layer, { mapping: {} });
    expect(joined.matched).toBe(2);
    expect(joined.units.map((u) => [u.name, u.count])).toEqual([['Palmeiras', 2]]);
    expect(joined.units[0].context).toEqual([{ label: 'Município', value: 'Leopoldina' }]);
  });
});
