import { describe, it, expect } from 'vitest';
import { matchCommunities, foldName } from '../../components/layers/CommunityLayerTools.jsx';

const muns = [
  { cod: '3138401', layerId: 'communities:3138401', name: 'Leopoldina', communities: [{ id: 'a', name: 'Palmeiras' }, { id: 'b', name: 'Ribeiro Junqueira' }] },
  { cod: '3115300', layerId: 'communities:3115300', name: 'Cataguases', communities: [{ id: 'c', name: 'Sereninho' }, { id: 'd', name: 'Glória' }] },
];

describe('filtro de comunidades no painel', () => {
  it('sem texto, todos os municípios entram inteiros', () => {
    const r = matchCommunities(muns, '  ');
    expect(r.map((m) => m.cod)).toEqual(['3138401', '3115300']);
    expect(r.every((m) => m.munMatch && !m.matches.length)).toBe(true);
  });
  it('acha pelo nome da comunidade, sem acento e sem caixa', () => {
    const r = matchCommunities(muns, 'gloria');
    expect(r).toHaveLength(1);
    expect(r[0].munMatch).toBe(false);
    expect(r[0].matches.map((c) => c.id)).toEqual(['d']);
  });
  it('acha pelo nome do município', () => {
    const r = matchCommunities(muns, 'leopol');
    expect(r).toHaveLength(1);
    expect(r[0].munMatch).toBe(true);
  });
  it('foldName normaliza', () => expect(foldName('  Glória  de  MINAS ')).toBe('gloria de minas'));
});
