import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assignCommunityColors, COMMUNITY_PALETTE } from '../communityColors.js';

const dir = join(process.cwd(), 'public/data/comunidades');
const all = readdirSync(dir).filter((f) => f.startsWith('microrregioes_') && f.endsWith('.geojson'))
  .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).features.map((ft) => ({ id: `${f}:${ft.properties.ID}`, geometry: ft.geometry })));

const key = ([x, y]) => `${Math.round(x * 1e4)}:${Math.round(y * 1e4)}`;
const verts = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);

describe('cores das comunidades', () => {
  it('quadrados vizinhos ficam com cores diferentes', () => {
    const sq = (id, x) => ({ id, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
    const c = assignCommunityColors([sq('a', 0), sq('b', 1), sq('c', 2)]);
    expect(c.get('a')).not.toBe(c.get('b'));
    expect(c.get('b')).not.toBe(c.get('c'));
  });

  it(`nas ${all.length} comunidades reais, nenhuma vizinha com a mesma cor`, () => {
    const colors = assignCommunityColors(all);
    expect(colors.size).toBe(all.length);
    [...colors.values()].forEach((v) => expect(COMMUNITY_PALETTE).toContain(v));
    const owners = new Map();
    all.forEach((c) => verts(c.geometry).forEach((p) => {
      const k = key(p);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(c.id);
    }));
    const clashes = new Set();
    owners.forEach((ids) => {
      const list = [...ids];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (colors.get(list[i]) === colors.get(list[j])) clashes.add([list[i], list[j]].sort().join('|'));
        }
      }
    });
    expect(clashes.size).toBe(0);
  });
});
