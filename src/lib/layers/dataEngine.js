/**
 * Motor das camadas de dados grandes (roda no Web Worker).
 *
 * Em vez de mandar GeoJSON bruto para o mapa, cada camada vira um índice de
 * "vector tiles" no próprio navegador (geojson-vt): os tiles são cortados e
 * simplificados por nível de zoom sob demanda, e só o que está na tela é
 * enviado para desenho, em formato binário compacto. É o equivalente local
 * do ST_AsMVT/PMTiles da especificação, enquanto não há backend.
 *
 * Também calcula: atributos de uma feição clicada, resumo dentro de um
 * polígono (contagem, km de linha, km² de área, em metros reais) e o filtro
 * "só o que está dentro da sub-região".
 */
import geojsonvt from 'geojson-vt';
import Flatbush from 'flatbush';
import {
  haversineMeters, areaM2, intersectGeometries, geometryBboxAny, bboxIntersects, polygonsOf, preparePointInPolygon,
} from '../geoOps.js';
import { GEOMETRY_FAMILY } from './importEngine.js';

export const TILE_EXTENT = 4096;
export const TILE_BUFFER = 64;
export const INDEX_MAX_ZOOM = 16;

/** Coordenada do mapa → pixel global (Web Mercator, tiles de 256 px). */
export function lngLatToWorld(lng, lat, z) {
  const s = 256 * 2 ** z;
  const x = ((lng + 180) / 360) * s;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return [x, y];
}

const isPointType = (t) => t === 'Point' || t === 'MultiPoint';

/**
 * Cria o índice de tiles.
 * - Pontos: índice espacial próprio (Flatbush) em coordenadas Web Mercator;
 *   cada tile é uma consulta por caixa, rarefeita por pixel em zoom baixo.
 * - Linhas e polígonos: geojson-vt (corte e simplificação por zoom).
 * As propriedades ficam fora do índice (só o id interno __fid entra).
 */
export function buildIndex(features) {
  const px = [];
  const py = [];
  const pfid = [];
  const others = [];
  for (let i = 0; i < features.length; i += 1) {
    const g = features[i].geometry;
    if (isPointType(g.type)) {
      const list = g.type === 'Point' ? [g.coordinates] : g.coordinates;
      for (const c of list) {
        const [x, y] = lngLatToWorld(c[0], c[1], 0);
        px.push(x); py.push(y); pfid.push(i);
      }
    } else {
      others.push({ type: 'Feature', geometry: g, properties: { __fid: i } });
    }
  }
  let points = null;
  if (px.length) {
    const index = new Flatbush(px.length);
    for (let i = 0; i < px.length; i += 1) index.add(px[i], py[i], px[i], py[i]);
    index.finish();
    points = {
      index, x: Float64Array.from(px), y: Float64Array.from(py), fid: Uint32Array.from(pfid),
    };
  }
  const vt = others.length ? geojsonvt({ type: 'FeatureCollection', features: others }, {
    maxZoom: INDEX_MAX_ZOOM,
    indexMaxZoom: 5,
    indexMaxPoints: 100000,
    tolerance: 3,
    extent: TILE_EXTENT,
    buffer: TILE_BUFFER,
  }) : null;
  return { vt, points };
}

function rawTile(index, z, x, y) {
  if (!index.vt) return { tile: null, scale: 1, dx: 0, dy: 0 };
  if (z <= INDEX_MAX_ZOOM) return { tile: index.vt.getTile(z, x, y), scale: 1, dx: 0, dy: 0 };
  // Acima do zoom máximo do índice: reaproveita o tile ancestral, ampliado.
  const k = z - INDEX_MAX_ZOOM;
  const ax = x >> k;
  const ay = y >> k;
  const scale = 1 << k;
  return {
    tile: index.vt.getTile(INDEX_MAX_ZOOM, ax, ay), scale, dx: (x - ax * scale) * TILE_EXTENT, dy: (y - ay * scale) * TILE_EXTENT,
  };
}

const UNIT = TILE_EXTENT / 256;
const GRID = 256 + 2 * (TILE_BUFFER / UNIT);

/**
 * Tile em formato compacto (arrays tipados, transferíveis):
 *   types[i]  1 ponto | 2 linha | 3 polígono      fids[i] índice da feição
 *   featPart[i]..featPart[i+1]  partes da feição  parts[p]..parts[p+1]  pares em coords
 *   coords    Int16 [x, y, …] em unidades do tile (0..4096)
 *   values    { campo: valores[] } — só os campos usados pelo estilo
 * Ordem: polígonos e linhas primeiro, pontos por cima.
 * Pontos em zoom baixo são rarefeitos (no máximo um por pixel).
 */
export function packTile(index, features, z, x, y, { fields = [], thinPointsBelowZoom = 15 } = {}) {
  const types = [];
  const fids = [];
  const featPart = [0];
  const parts = [0];
  const coords = [];
  const clampI16 = (v) => Math.max(-32000, Math.min(32000, Math.round(v)));

  const { tile, scale, dx, dy } = rawTile(index, z, x, y);
  if (tile) {
    for (const f of tile.features) {
      if (f.type === 1) continue;
      for (const ring of f.geometry) {
        for (const [px, py] of ring) coords.push(clampI16(px * scale - dx), clampI16(py * scale - dy));
        parts.push(coords.length / 2);
      }
      types.push(f.type);
      fids.push(f.tags.__fid);
      featPart.push(parts.length - 1);
    }
  }

  if (index.points) {
    const k = 2 ** z;
    const b = TILE_BUFFER / UNIT / k;
    const minX = (x * 256) / k - b;
    const minY = (y * 256) / k - b;
    const maxX = ((x + 1) * 256) / k + b;
    const maxY = ((y + 1) * 256) / k + b;
    const hits = index.points.index.search(minX, minY, maxX, maxY);
    const occupied = z < thinPointsBelowZoom ? new Uint8Array(GRID * GRID) : null;
    const off = TILE_BUFFER / UNIT;
    for (const i of hits) {
      const tx = index.points.x[i] * k - x * 256; // pixels do tile (0..256)
      const ty = index.points.y[i] * k - y * 256;
      if (occupied) {
        const cell = Math.floor(ty + off) * GRID + Math.floor(tx + off);
        if (occupied[cell]) continue;
        occupied[cell] = 1;
      }
      coords.push(Math.round(tx * UNIT), Math.round(ty * UNIT));
      parts.push(coords.length / 2);
      types.push(1);
      fids.push(index.points.fid[i]);
      featPart.push(parts.length - 1);
    }
  }

  const values = {};
  fields.forEach((field) => { values[field] = fids.map((fid) => features[fid]?.properties?.[field] ?? null); });
  return {
    n: types.length,
    types: Uint8Array.from(types),
    fids: Uint32Array.from(fids),
    featPart: Uint32Array.from(featPart),
    parts: Uint32Array.from(parts),
    coords: Int16Array.from(coords),
    values,
  };
}

const segDist2 = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
};
const ringContains = (px, py, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Feição sob o cursor. Pontos e linhas têm prioridade sobre polígonos.
 * @returns {{ fid, properties, geometryType } | null}
 */
export function hitTest(index, features, {
  lng, lat, zoom, tolerancePx = 6,
}) {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const result = (fid) => {
    const src = features[fid];
    return { fid, properties: src?.properties ?? {}, geometryType: GEOMETRY_FAMILY[src?.geometry?.type] ?? null };
  };
  if (index.points) {
    const [x0, y0] = lngLatToWorld(lng, lat, 0);
    const near = index.points.index.neighbors(x0, y0, 1, tolerancePx / 2 ** z);
    if (near.length) return result(index.points.fid[near[0]]);
  }
  const [wx, wy] = lngLatToWorld(lng, lat, z);
  const x = Math.floor(wx / 256);
  const y = Math.floor(wy / 256);
  const { tile, scale, dx, dy } = rawTile(index, z, x, y);
  if (!tile) return null;
  const px = (wx - x * 256) * UNIT;
  const py = (wy - y * 256) * UNIT;
  const tol2 = (tolerancePx * UNIT) ** 2;
  let best = null;
  let bestD = Infinity;
  let polygonHit = null;
  const T = (p) => [p[0] * scale - dx, p[1] * scale - dy];
  for (const f of tile.features) {
    if (f.type === 2) {
      for (const line of f.geometry) {
        for (let i = 1; i < line.length; i += 1) {
          const [ax, ay] = T(line[i - 1]);
          const [bx, by] = T(line[i]);
          const d = segDist2(px, py, ax, ay, bx, by);
          if (d <= tol2 && d < bestD) { bestD = d; best = f; }
        }
      }
    } else if (f.type === 3 && !polygonHit) {
      let inside = false;
      f.geometry.forEach((ring) => { if (ringContains(px, py, ring.map(T))) inside = !inside; });
      if (inside) polygonHit = f;
    }
  }
  const hit = best ?? polygonHit;
  return hit ? result(hit.tags.__fid) : null;
}

/* ------------------------------------------------------------------ */
/* Recortes por polígono                                               */
/* ------------------------------------------------------------------ */

/** Índice das arestas do polígono, para cortar linhas rapidamente. */
function polygonEdges(polygon) {
  const segs = [];
  polygonsOf(polygon).forEach((poly) => poly.forEach((ring) => {
    for (let i = 1; i < ring.length; i += 1) segs.push([ring[i - 1], ring[i]]);
  }));
  const index = new Flatbush(Math.max(1, segs.length));
  segs.forEach(([a, b]) => index.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])));
  if (!segs.length) index.add(0, 0, 0, 0);
  index.finish();
  return { index, segs };
}

/** Parâmetro t (0..1) onde o segmento a→b cruza c→d, ou null. */
function crossParam(a, b, c, d) {
  const rx = b[0] - a[0]; const ry = b[1] - a[1];
  const sx = d[0] - c[0]; const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** Comprimento (m) de uma polilinha que fica dentro do polígono. */
export function lengthInsideMeters(line, inside, edges) {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const ts = [0, 1];
    edges.index.search(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])).forEach((k) => {
      const t = crossParam(a, b, edges.segs[k][0], edges.segs[k][1]);
      if (t !== null) ts.push(t);
    });
    ts.sort((p, q) => p - q);
    for (let j = 1; j < ts.length; j += 1) {
      const t0 = ts[j - 1];
      const t1 = ts[j];
      if (t1 - t0 < 1e-12) continue;
      const mid = (t0 + t1) / 2;
      const m = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
      if (inside(m)) {
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        total += haversineMeters(p0, p1);
      }
    }
  }
  return total;
}

const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
const pointsOf = (g) => (g.type === 'Point' ? [g.coordinates] : g.coordinates);

/** Caixas das feições (calculadas uma vez por camada). */
export function featureBoxes(features) {
  const index = new Flatbush(Math.max(1, features.length));
  features.forEach((f) => {
    const [a, b, c, d] = geometryBboxAny(f.geometry);
    index.add(a, b, c, d);
  });
  if (!features.length) index.add(0, 0, 0, 0);
  index.finish();
  return index;
}

/**
 * Resumo das feições dentro de um polígono.
 * @returns {{ points, lineMeters, lineFeatures, polygons, polygonM2, features }}
 */
export function summarizeInside(features, boxes, polygon) {
  const [minX, minY, maxX, maxY] = geometryBboxAny(polygon);
  const edges = polygonEdges(polygon);
  const inside = preparePointInPolygon(polygon);
  const out = {
    points: 0, lineMeters: 0, lineFeatures: 0, polygons: 0, polygonM2: 0, features: 0,
  };
  const candidates = features.length ? boxes.search(minX, minY, maxX, maxY) : [];
  for (const i of candidates) {
    const g = features[i].geometry;
    const fam = GEOMETRY_FAMILY[g.type];
    if (fam === 'point') {
      const n = pointsOf(g).filter(inside).length;
      if (n) { out.points += n; out.features += 1; }
    } else if (fam === 'line') {
      const m = linesOf(g).reduce((sum, l) => sum + lengthInsideMeters(l, inside, edges), 0);
      if (m > 0) { out.lineMeters += m; out.lineFeatures += 1; out.features += 1; }
    } else if (fam === 'polygon') {
      const inter = intersectGeometries(g, polygon);
      const a = inter ? areaM2(inter) : 0;
      if (a > 0) { out.polygonM2 += a; out.polygons += 1; out.features += 1; }
    }
  }
  return out;
}

/** Índices das feições que tocam o polígono (filtro "só dentro da sub-região"). */
export function filterInside(features, boxes, polygon) {
  const [minX, minY, maxX, maxY] = geometryBboxAny(polygon);
  const bbox = [minX, minY, maxX, maxY];
  const edges = polygonEdges(polygon);
  const test = preparePointInPolygon(polygon);
  const keep = [];
  const candidates = features.length ? boxes.search(minX, minY, maxX, maxY) : [];
  for (const i of candidates) {
    const g = features[i].geometry;
    const fam = GEOMETRY_FAMILY[g.type];
    let hit = false;
    if (fam === 'point') hit = pointsOf(g).some(test);
    else if (fam === 'line') hit = linesOf(g).some((l) => l.some(test) || lengthInsideMeters(l, test, edges) > 0);
    else if (fam === 'polygon') hit = bboxIntersects(geometryBboxAny(g), bbox) && !!intersectGeometries(g, polygon);
    if (hit) keep.push(i);
  }
  return keep.sort((a, b) => a - b);
}

/** Estatística de um campo (para montar estilos por atributo). */
export function fieldStats(features, field, { maxUnique = 200 } = {}) {
  const counts = new Map();
  const numbers = [];
  let numeric = 0;
  let filled = 0;
  for (const f of features) {
    const v = f.properties?.[field];
    if (v === null || v === undefined || v === '') continue;
    filled += 1;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (Number.isFinite(n)) { numeric += 1; numbers.push(n); }
    const key = String(v);
    if (counts.size < maxUnique || counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  numbers.sort((a, b) => a - b);
  return {
    field,
    filled,
    numeric: filled > 0 && numeric === filled,
    uniqueCapped: counts.size >= maxUnique,
    values: [...counts.entries()].map(([value, count]) => ({ value, count })),
    sortedNumbers: numbers.length > 20000 ? numbers.filter((_, i) => i % Math.ceil(numbers.length / 20000) === 0) : numbers,
    min: numbers[0] ?? null,
    max: numbers[numbers.length - 1] ?? null,
  };
}
