/**
 * Cores das comunidades no mapa: tons pastel em que comunidades vizinhas
 * ficam com cores diferentes (as cores só separam vizinhas, não têm significado).
 *
 * Vizinhança = compartilhar ao menos um vértice (arredondado a ~11 m). As
 * comunidades do arquivo são geradas lado a lado, com divisas coincidentes,
 * então isso basta. Coloração gulosa, da comunidade com mais vizinhas para a
 * com menos; se faltar cor, fica a menos usada entre as vizinhas.
 */

/** Paleta pastel (mesma família do mapa de referência aprovado). */
export const COMMUNITY_PALETTE = [
  '#B3CDE3', // azul
  '#BFE5DD', // verde-água
  '#DAD8EA', // lavanda
  '#FDE0EF', // rosa
  '#FDD3A6', // pêssego
  '#E0F3DB', // verde-claro
  '#FFFBCC', // amarelo
  '#D8B4D8', // lilás
  '#D2EBA8', // verde-limão
];

/** Cinza das áreas urbanas (fora das comunidades rurais). */
export const URBAN_FILL = '#9CA3AF';

const GRID = 1e4; // 1e-4 grau ≈ 11 m

function forEachVertex(geometry, fn) {
  if (!geometry) return;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  polys.forEach((rings) => rings.forEach((ring) => ring.forEach(fn)));
}

/**
 * @param {{id: string, geometry: object}[]} communities
 * @returns {Map<string, string>} id → cor
 */
export function assignCommunityColors(communities, palette = COMMUNITY_PALETTE) {
  const owners = new Map(); // célula → Set de ids
  communities.forEach((c) => {
    forEachVertex(c.geometry, ([x, y]) => {
      const k = `${Math.round(x * GRID)}:${Math.round(y * GRID)}`;
      let s = owners.get(k);
      if (!s) { s = new Set(); owners.set(k, s); }
      s.add(c.id);
    });
  });
  const neighbors = new Map(communities.map((c) => [c.id, new Set()]));
  owners.forEach((ids) => {
    if (ids.size < 2) return;
    ids.forEach((a) => ids.forEach((b) => { if (a !== b) neighbors.get(a).add(b); }));
  });

  const order = [...communities].sort((a, b) => neighbors.get(b.id).size - neighbors.get(a.id).size || String(a.id).localeCompare(String(b.id)));
  const color = new Map();
  const used = new Array(palette.length).fill(0);
  order.forEach((c) => {
    const taken = new Map();
    neighbors.get(c.id).forEach((n) => {
      const i = color.get(n);
      if (i != null) taken.set(i, (taken.get(i) ?? 0) + 1);
    });
    let best = -1;
    for (let i = 0; i < palette.length; i += 1) {
      if (!taken.has(i) && (best < 0 || used[i] < used[best])) best = i;
    }
    if (best < 0) {
      best = 0;
      for (let i = 1; i < palette.length; i += 1) if (taken.get(i) < taken.get(best)) best = i;
    }
    color.set(c.id, best);
    used[best] += 1;
  });
  return new Map([...color].map(([id, i]) => [id, palette[i]]));
}
