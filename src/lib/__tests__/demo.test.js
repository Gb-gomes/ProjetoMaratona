import { describe, it, expect } from 'vitest';
import { mockSpatialJoin } from '../mockSpatialJoin.js';
import { DEMO_POINTS, DEMO_TERRITORIES } from '../../data/mockData.js';
import { summarize } from '../summary.js';

describe('modo demonstração (regressão)', () => {
  const res = mockSpatialJoin(DEMO_POINTS, DEMO_TERRITORIES);

  it('mantém as quatro unidades demonstrativas 24 + 31 + 28 + 17', () => {
    expect(res.source).toBe('demo');
    expect(res.units.map((u) => [u.name, u.count])).toEqual([
      ['São Pedro', 24], ['Boa Vista', 31], ['Santa Rita', 28], ['Água Limpa', 17],
    ]);
  });

  it('usa o mesmo formato de resultado do modo real e é consistente', () => {
    expect(summarize(res, res.units.map((u) => u.id)).consistent).toBe(true);
    expect(res.points).toHaveLength(100);
    expect(res.geometryMismatches).toBe(0);
  });
});
