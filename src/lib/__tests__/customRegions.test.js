import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  clipToParent, validateDraft, createRegion, updateRegion, softDeleteRegion, restoreRegion, duplicateDraft, findOverlaps,
  regionsToGeoJSON, polygonFromGeoJSON, nameKey, descendantsOf,
} from '../customRegions.js';
import {
  unionGeometries, areaKm2, perimeterKm, haversineMeters, intersectGeometries,
} from '../geoOps.js';

const hierarchy = JSON.parse(readFileSync('public/data/ibge/hierarquia_piloto.geojson', 'utf8'));
const sectors = JSON.parse(readFileSync('public/data/ibge/camada_piloto.geojson', 'utf8'));
const cataguases = hierarchy.features.find((f) => f.properties.code === '3115300').geometry;

/** Retângulo em graus [oeste, sul, leste, norte]. */
const rect = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
// Quadrado de ~1,1 km no centro urbano de Cataguases.
const INSIDE = rect(-42.70, -21.40, -42.69, -21.39);
const ctx = (regions, extra = {}) => ({
  regions, orgId: 'org-a', parentGeometry: cataguases, ...extra,
});
const draft = (over = {}) => ({
  name: 'Centro', geometry: INSIDE, ibgeParentCode: '3115300', creationMethod: 'drawn', ...over,
});

describe('geoOps', () => {
  it('calcula área e perímetro geodésicos', () => {
    const a = areaKm2(INSIDE);
    expect(a).toBeGreaterThan(1.1);
    expect(a).toBeLessThan(1.25);
    expect(perimeterKm(INSIDE)).toBeCloseTo(4 * 1.08, 0);
    expect(haversineMeters([-42.7, -21.4], [-42.7, -21.39])).toBeCloseTo(1112, -1);
  });

  it('corrige polígono com autointerseção (gravata-borboleta)', () => {
    const bow = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] };
    const fixed = unionGeometries([bow]);
    expect(fixed.type).toBe('MultiPolygon');
    expect(fixed.coordinates.length).toBe(2);
  });

  it('a união dos setores censitários coincide com o município oficial', () => {
    const u = unionGeometries(sectors.features.map((f) => f.geometry));
    expect(Math.abs(areaKm2(u) - areaKm2(cataguases))).toBeLessThan(0.01);
  });
});

describe('contenção na região-mãe', () => {
  it('área totalmente interna não é recortada', () => {
    const p = clipToParent(INSIDE, cataguases);
    expect(p.clipped).toBe(false);
    expect(p.empty).toBe(false);
  });

  it('desenho que ultrapassa a borda é recortado e avisado', () => {
    // Retângulo que atravessa o limite municipal no extremo oeste.
    const crossing = rect(-42.86, -21.30, -42.76, -21.25);
    const p = clipToParent(crossing, cataguases);
    expect(p.clipped).toBe(true);
    expect(p.beyondTolerance).toBe(true);
    expect(p.clippedAreaKm2).toBeGreaterThan(0.1);
    expect(areaKm2(p.geometry)).toBeLessThan(p.inputAreaKm2);
    const v = validateDraft(draft({ geometry: crossing }), ctx([]));
    expect(v.ok).toBe(true);
    expect(v.warnings[0]).toMatch(/recortados/);
  });

  it('pequena imprecisão (dentro da tolerância) é recortada sem aviso', () => {
    // Setor da borda deslocado ~10 m para fora.
    const edge = sectors.features[0].geometry;
    const shifted = {
      type: edge.type,
      coordinates: JSON.parse(JSON.stringify(edge.coordinates), (k, v) => (Array.isArray(v) && typeof v[0] === 'number' ? [v[0] + 0.0001, v[1]] : v)),
    };
    const p = clipToParent(shifted, cataguases);
    expect(p.maxOutsideMeters).toBeLessThan(50);
    expect(p.beyondTolerance).toBe(false);
  });

  it('área fora da região-mãe é rejeitada', () => {
    const v = validateDraft(draft({ geometry: rect(-43.5, -20, -43.4, -19.9) }), ctx([]));
    expect(v.ok).toBe(false);
    expect(v.errors.geometry).toMatch(/fora da região-mãe/);
  });
});

describe('nome e sobreposição', () => {
  const { regions } = createRegion([], draft(), ctx([]), { by: 'ana', id: 'r1' });

  it('nome duplicado na mesma região-mãe é impedido (sem diferenciar acento/caixa)', () => {
    const v = validateDraft(draft({ name: '  centro ', geometry: rect(-42.68, -21.40, -42.67, -21.39) }), ctx(regions));
    expect(v.errors.name).toMatch(/Já existe/);
    expect(nameKey('Água Limpa')).toBe(nameKey('agua  limpa'));
  });

  it('o mesmo nome é aceito em outra organização ou outra região-mãe', () => {
    expect(validateDraft(draft({ geometry: rect(-42.68, -21.40, -42.67, -21.39) }), ctx(regions, { orgId: 'org-b' })).errors.name).toBeUndefined();
  });

  it('sobreposição entre irmãs é bloqueada por padrão e permitida pela organização', () => {
    const overlapping = draft({ name: 'Centro Sul', geometry: rect(-42.695, -21.405, -42.685, -21.395) });
    expect(validateDraft(overlapping, ctx(regions)).errors.overlap).toMatch(/Sobreposição com "Centro"/);
    expect(validateDraft(overlapping, ctx(regions, { rules: { allowSiblingOverlap: true } })).ok).toBe(true);
  });

  it('bordas coincidentes não contam como sobreposição', () => {
    const neighbor = rect(-42.69, -21.40, -42.68, -21.39);
    expect(findOverlaps(neighbor, regions)).toEqual([]);
  });
});

describe('aninhamento, edição, exclusão', () => {
  let regions = createRegion([], draft(), ctx([]), { by: 'ana', id: 'r1' }).regions;
  const parent = regions[0];
  const inner = rect(-42.698, -21.398, -42.694, -21.394);
  regions = createRegion(regions, draft({ name: 'Praça', geometry: inner, parentCustomRegionId: 'r1' }), ctx(regions, { parentGeometry: parent.geometry }), { by: 'ana', id: 'r2' }).regions;

  it('sub-região aninhada fica contida na sub-região-mãe', () => {
    const v = validateDraft(draft({ name: 'Fora', geometry: rect(-42.689, -21.399, -42.685, -21.395), parentCustomRegionId: 'r1' }), ctx(regions, { parentGeometry: parent.geometry }));
    expect(v.errors.geometry).toMatch(/fora/);
  });

  it('editar a mãe não pode deixar filhas de fora', () => {
    expect(() => updateRegion(regions, 'r1', { geometry: rect(-42.693, -21.40, -42.69, -21.39) }, ctx(regions), { by: 'ana' }))
      .toThrow(/Praça/);
  });

  it('renomear registra o histórico e recalcula métricas da geometria', () => {
    const { regions: next, region } = updateRegion(regions, 'r1', { name: 'Centro Histórico', geometry: rect(-42.705, -21.405, -42.69, -21.39) }, ctx(regions), { by: 'bia' });
    expect(region.name).toBe('Centro Histórico');
    expect(region.areaKm2).toBeGreaterThan(parent.areaKm2);
    expect(region.history.at(-1).changes.name).toEqual({ from: 'Centro', to: 'Centro Histórico' });
    expect(next.find((r) => r.id === 'r1').updatedBy).toBe('bia');
  });

  it('exclusão lógica leva as descendentes e preserva o histórico', () => {
    const { regions: next, count } = softDeleteRegion(regions, 'r1', { by: 'ana' });
    expect(count).toBe(2);
    expect(next.every((r) => r.deletedAt)).toBe(true);
    expect(next[1].history.at(-1).action).toBe('excluída');
    expect(descendantsOf(next, 'r1')).toEqual([]);
    const restored = restoreRegion(next, 'r1', {}, { by: 'ana' });
    expect(restored.find((r) => r.id === 'r1').deletedAt).toBeNull();
  });

  it('duplicar propõe nome livre e a mesma área (sobreposta, a ajustar)', () => {
    const d = duplicateDraft(regions, parent);
    expect(d.name).toBe('Centro (cópia)');
    expect(validateDraft(d, ctx(regions)).errors.overlap).toBeTruthy();
  });

  it('exporta GeoJSON e reimporta o polígono', () => {
    const gj = regionsToGeoJSON(regions.filter((r) => !r.deletedAt));
    expect(gj.features).toHaveLength(2);
    expect(gj.features[0].properties.nome).toBe('Centro');
    const { geometry } = polygonFromGeoJSON(gj);
    expect(areaKm2(intersectGeometries(geometry, parent.geometry))).toBeCloseTo(parent.areaKm2, 2);
  });
});
