import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { placeCommunityLabels, labelBoxWidth, MIN_ZOOM } from '../communityLabels.js';

// Projeção Web Mercator em pixels absolutos (igual ao Leaflet).
const project = (zoom) => (lat, lng) => {
  const s = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
};
const regions = JSON.parse(readFileSync('public/data/comunidades/microrregioes_3115300.geojson', 'utf8')).features.map((f) => ({
  id: f.properties.ID, name: f.properties.COMUNIDADE, labelPoint: [f.properties.CENTRO_LON, f.properties.CENTRO_LAT], areaKm2: f.properties.AREA_KM2,
}));
const place = (z, opts) => placeCommunityLabels(regions, z, project(z), opts);

describe('nomes das comunidades por zoom', () => {
  it('de muito longe nenhum nome (só a selecionada)', () => {
    expect(place(MIN_ZOOM - 1).size).toBe(0);
    expect([...place(MIN_ZOOM - 1, { selectedId: 'GOIABAL' })]).toEqual(['GOIABAL']);
  });
  it('quanto mais perto, mais nomes; no zoom 13 praticamente todos', () => {
    const n = [9, 10, 11, 12, 13].map((z) => place(z).size);
    for (let i = 1; i < n.length; i += 1) expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[4]).toBeGreaterThanOrEqual(regions.length - 3);
  });
  it('nenhum nome encavala em outro', () => {
    [10, 11, 12].forEach((z) => {
      const p = project(z);
      const boxes = regions.filter((r) => place(z).has(r.id)).map((r) => {
        const c = p(r.labelPoint[1], r.labelPoint[0]);
        const w = labelBoxWidth(r.name);
        return [c.x - w / 2, c.x + w / 2, c.y - 7.5, c.y + 7.5];
      });
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const [a, b] = [boxes[i], boxes[j]];
          expect(a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2]).toBe(false);
        }
      }
    });
  });
});
