import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHierarchy } from '../ibgeHierarchy.js';
import {
  parseCommunityFile, importCommunities, planCommunityAdjust, adjustCommunityBorder, describeAdjustPlan,
} from '../communities.js';
import {
  intersectGeometries, differenceGeometries, unionGeometries, areaM2, distanceToBoundaryMeters, geometryBboxAny,
} from '../geoOps.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const main = read('public/data/ibge/hierarquia_piloto.geojson');
const hierarchy = parseHierarchy({ type: 'FeatureCollection', features: main.features, ufSigla: 'MG' });
const name = 'microrregioes_3115300.geojson';
const parsed = parseCommunityFile(read(`public/data/comunidades/${name}`), { fileName: name, municipalityExists: () => true });
const mun = hierarchy.byCode.get('3115300');
const { regions } = importCommunities([], parsed, {
  orgId: 'energisa', municipalityGeometry: mun.geometry, municipalityName: mun.name, fileName: name, by: 'ana',
});
const byName = (list, n) => list.find((r) => r.name === n);
const total = (list) => list.filter((r) => !r.deletedAt).reduce((a, r) => a + areaM2(r.geometry), 0);
const box = ([x, y], d) => ({ type: 'Polygon', coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] });

// Turiacu e Roda Dagua são vizinhas (mapa de referência de Cataguases).
const A = byName(regions, 'Turiacu');
const B = byName(regions, 'Roda Dagua');
const shared = A.geometry.coordinates.flat(2).length
  ? (A.geometry.type === 'Polygon' ? [A.geometry.coordinates] : A.geometry.coordinates).flat(2)
    .find((p) => distanceToBoundaryMeters(p, B.geometry) < 1 && distanceToBoundaryMeters(p, mun.geometry) > 800
      && regions.every((r) => r.id === A.id || r.id === B.id || distanceToBoundaryMeters(p, r.geometry) > 800))
  : null;

describe('ajuste de contorno com as vizinhas', () => {
  it('as duas comunidades de teste são vizinhas', () => expect(shared).toBeTruthy());

  it('aumentar uma tira a mesma área da vizinha (área total conservada)', () => {
    const grab = intersectGeometries(B.geometry, box(shared, 0.006));
    const grown = unionGeometries([A.geometry, grab]);
    const { regions: next, plan } = adjustCommunityBorder(regions, A.id, grown, { by: 'ana' });
    const gained = areaM2(grown) - areaM2(A.geometry);
    expect(plan.taken.map((t) => t.name)).toContain('Roda Dagua');
    expect(areaM2(B.geometry) - areaM2(byName(next, 'Roda Dagua').geometry)).toBeCloseTo(gained, -2);
    expect(Math.abs(total(next) - total(regions)) / total(regions)).toBeLessThan(1e-4);
    // sem sobreposição entre a editada e a vizinha
    const ov = intersectGeometries(byName(next, 'Turiacu').geometry, byName(next, 'Roda Dagua').geometry);
    expect(ov ? areaM2(ov) : 0).toBeLessThan(1);
    expect(byName(next, 'Roda Dagua').history.at(-1).changes.motivo).toMatch(/cedeu .* no ajuste de "Turiacu"/);
  });

  it('diminuir uma passa a área solta para a vizinha que encosta', () => {
    const cut = intersectGeometries(A.geometry, box(shared, 0.004));
    const shrunk = differenceGeometries(A.geometry, cut);
    const plan = planCommunityAdjust(regions, A.id, shrunk);
    const given = plan.given.reduce((a, g) => a + g.km2, 0) + plan.orphanKm2;
    expect(given * 1e6).toBeCloseTo(areaM2(cut), -2);
    expect(plan.given.map((g) => g.name)).toContain('Roda Dagua');
    expect(describeAdjustPlan(plan).join(' ')).toMatch(/Vai passar área para: .*Roda Dagua/);
    const { regions: next } = adjustCommunityBorder(regions, A.id, shrunk, { by: 'ana' });
    expect(Math.abs(total(next) - total(regions)) / total(regions)).toBeLessThan(1e-4);
  });

  it('não deixa engolir uma vizinha inteira (orienta a usar Unir)', () => {
    const all = unionGeometries([A.geometry, B.geometry]);
    expect(() => adjustCommunityBorder(regions, A.id, all, { by: 'ana' })).toThrow(/Unir/);
  });

  it('exige responsável', () => {
    expect(() => adjustCommunityBorder(regions, A.id, A.geometry, { by: ' ' })).toThrow(/responsável/);
  });

  it('bbox da comunidade editada continua válido', () => expect(geometryBboxAny(A.geometry)).toHaveLength(4));
});
