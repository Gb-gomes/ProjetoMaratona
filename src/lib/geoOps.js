/**
 * Operações geométricas sobre polígonos (GeoJSON, [lng, lat], EPSG:4326).
 *
 * Equivalentes no navegador das funções PostGIS da especificação:
 *   ST_Intersection → intersectGeometries   ST_Union      → unionGeometries
 *   ST_Difference   → differenceGeometries  ST_Area(geog) → areaKm2
 *   ST_Perimeter(geog) → perimeterKm (Haversine)
 * Áreas e comprimentos são calculados na esfera (metros reais), não em graus.
 */
import intersect from '@turf/intersect';
import union from '@turf/union';
import difference from '@turf/difference';
import turfArea from '@turf/area';
import { feature, featureCollection } from '@turf/helpers';
import Flatbush from 'flatbush';
import { pointInFeature } from './geo.js';

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const DECIMALS = 1e7;

/** Distância Haversine em metros entre [lng, lat]. */
export function haversineMeters([lng1, lat1], [lng2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const isPolygonal = (g) => g?.type === 'Polygon' || g?.type === 'MultiPolygon';

/** Lista de polígonos (cada um: lista de anéis) de uma geometria poligonal. */
export const polygonsOf = (g) => {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
};

/** Normaliza para MultiPolygon, arredondando a 7 casas (≈ 1 cm). */
export function toMultiPolygon(g) {
  const coordinates = polygonsOf(g)
    .map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(x * DECIMALS) / DECIMALS, Math.round(y * DECIMALS) / DECIMALS])))
    .filter((poly) => poly[0]?.length >= 4);
  return coordinates.length ? { type: 'MultiPolygon', coordinates } : null;
}

const asFeature = (g) => feature(g);

/* Arredonda a `dec` casas, sem vértices repetidos em sequência. */
function snapGeometry(g, dec) {
  const k = 10 ** dec;
  const coordinates = polygonsOf(g).map((poly) => poly.map((ring) => ring
    .map(([x, y]) => [Math.round(x * k) / k, Math.round(y * k) / k])
    .filter((p, i, r) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]))
    .filter((ring) => ring.length >= 4))
    .filter((poly) => poly.length);
  return coordinates.length ? { type: 'MultiPolygon', coordinates } : null;
}

/**
 * Executa a operação do polygon-clipping e, se ela falhar ("Unable to complete output ring"),
 * tenta de novo com as geometrias arredondadas a 6 e depois 5 casas (≈ 10 cm e 1 m).
 * A falha acontece com bordas quase coincidentes, ex.: comunidade feita dos setores × limite municipal.
 */
function robust(op, geoms) {
  try {
    return op(geoms);
  } catch (err) {
    for (const dec of [6, 5]) {
      const snapped = geoms.map((g) => snapGeometry(g, dec));
      if (snapped.some((g) => !g)) break;
      try { return op(snapped); } catch { /* próxima precisão */ }
    }
    throw err;
  }
}

/* Recorte de um anel por uma caixa (Sutherland-Hodgman). */
function clipRingToBox(ring, [minX, minY, maxX, maxY]) {
  const edges = [
    (p) => p[0] >= minX, (p) => p[0] <= maxX, (p) => p[1] >= minY, (p) => p[1] <= maxY,
  ];
  const cut = [
    (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])],
    (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY],
    (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY],
  ];
  let out = ring.slice(0, -1);
  for (let e = 0; e < 4 && out.length; e += 1) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[e](cur);
      const inPrev = edges[e](prev);
      if (inCur) {
        if (!inPrev) out.push(cut[e](prev, cur));
        out.push(cur);
      } else if (inPrev) out.push(cut[e](prev, cur));
    }
  }
  return out.length >= 3 ? [...out, out[0]] : null;
}

/**
 * Recorta uma geometria poligonal por uma caixa. Usado só para acelerar
 * interseção/diferença com regiões-mãe grandes: a caixa sempre contém, com
 * folga, a outra geometria, então as arestas artificiais ficam fora dela.
 */
export function clipToBox(g, box) {
  const coordinates = polygonsOf(g).map((poly) => {
    const outer = clipRingToBox(poly[0], box);
    if (!outer) return null;
    return [outer, ...poly.slice(1).map((r) => clipRingToBox(r, box)).filter(Boolean)];
  }).filter(Boolean);
  return coordinates.length ? { type: 'MultiPolygon', coordinates } : null;
}

const expandBox = ([a, b, c, d], m) => [a - m, b - m, c + m, d + m];
/** Versão de `big` reduzida à vizinhança de `small` (quando compensa). */
function nearPart(big, small) {
  const box = expandBox(geometryBboxAny(small), 0.01);
  const bb = geometryBboxAny(big);
  const inside = bb[0] >= box[0] && bb[1] >= box[1] && bb[2] <= box[2] && bb[3] <= box[3];
  return inside ? big : clipToBox(big, box);
}

/** Interseção (null se vazia). */
export function intersectGeometries(a, b) {
  if (!isPolygonal(a) || !isPolygonal(b)) return null;
  if (!bboxIntersects(geometryBboxAny(a), geometryBboxAny(b))) return null;
  const near = nearPart(b, a);
  if (!near) return null;
  const out = robust((gs) => intersect(featureCollection(gs.map(asFeature))), [a, near]);
  return out?.geometry ? toMultiPolygon(out.geometry) : null;
}

/** União de uma lista de geometrias poligonais (null se vazia). */
export function unionGeometries(list) {
  const geoms = list.filter(isPolygonal);
  if (!geoms.length) return null;
  if (geoms.length === 1) {
    // A união de um único polígono também resolve autointerseções (ST_MakeValid simplificado).
    const fixed = robust((gs) => union(featureCollection([asFeature(gs[0]), asFeature(gs[0])])), geoms);
    return fixed?.geometry ? toMultiPolygon(fixed.geometry) : null;
  }
  const out = robust((gs) => union(featureCollection(gs.map(asFeature))), geoms);
  return out?.geometry ? toMultiPolygon(out.geometry) : null;
}

/** a − b (null se vazia). */
export function differenceGeometries(a, b) {
  if (!isPolygonal(a)) return null;
  if (!isPolygonal(b) || !bboxIntersects(geometryBboxAny(a), geometryBboxAny(b))) return toMultiPolygon(a);
  const near = nearPart(b, a);
  if (!near) return toMultiPolygon(a);
  const out = robust((gs) => difference(featureCollection(gs.map(asFeature))), [a, near]);
  return out?.geometry ? toMultiPolygon(out.geometry) : null;
}

/** Área geodésica em m². */
export const areaM2 = (g) => (isPolygonal(g) ? turfArea(asFeature(g)) : 0);
export const areaKm2 = (g) => areaM2(g) / 1e6;

/** Comprimento de uma linha ([lng, lat][]) em metros. */
export function lineLengthMeters(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i += 1) s += haversineMeters(coords[i - 1], coords[i]);
  return s;
}

/** Perímetro (todos os anéis, incluindo buracos) em km. */
export const perimeterKm = (g) => polygonsOf(g).flat().reduce((s, ring) => s + lineLengthMeters(ring), 0) / 1000;

/** Caixa envolvente [minX, minY, maxX, maxY] de qualquer geometria GeoJSON. */
export function geometryBboxAny(g) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    for (let i = 0; i < c.length; i += 1) visit(c[i]);
  };
  if (g?.type === 'GeometryCollection') g.geometries.forEach((x) => visit(x.coordinates));
  else if (g?.coordinates) visit(g.coordinates);
  return [minX, minY, maxX, maxY];
}

export const bboxIntersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const mergeBbox = (list) => list.reduce(
  (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
  [Infinity, Infinity, -Infinity, -Infinity],
);

/** Distância em metros de um ponto a um segmento (projeção local; adequada até dezenas de km). */
export function pointSegmentMeters(p, a, b) {
  const kx = 111320 * Math.cos(toRad(p[1]));
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/* Índice espacial das arestas do contorno (reaproveitado por geometria). */
const edgeIndexCache = new WeakMap();
function edgeIndex(g) {
  if (edgeIndexCache.has(g)) return edgeIndexCache.get(g);
  const segs = [];
  polygonsOf(g).forEach((poly) => poly.forEach((ring) => {
    for (let i = 1; i < ring.length; i += 1) segs.push([ring[i - 1], ring[i]]);
  }));
  const index = new Flatbush(Math.max(1, segs.length));
  segs.forEach(([a, b]) => index.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])));
  if (!segs.length) index.add(0, 0, 0, 0);
  index.finish();
  const value = { index, segs };
  edgeIndexCache.set(g, value);
  return value;
}

/** Menor distância (m) de um ponto ao contorno de uma geometria poligonal. */
export function distanceToBoundaryMeters(p, g) {
  const { index, segs } = edgeIndex(g);
  if (!segs.length) return Infinity;
  // Candidatos pela distância em graus; a distância final é calculada em metros.
  let best = Infinity;
  index.neighbors(p[0], p[1], 24).forEach((i) => {
    const d = pointSegmentMeters(p, segs[i][0], segs[i][1]);
    if (d < best) best = d;
  });
  return best;
}

/** Maior distância (m) entre os vértices de `outside` e o contorno de `parent`. */
export function maxDistanceFromMeters(outside, parent) {
  let max = 0;
  polygonsOf(outside).forEach((poly) => poly.forEach((ring) => ring.forEach((p) => {
    const d = distanceToBoundaryMeters(p, parent);
    if (d > max) max = d;
  })));
  return max;
}

/** Ponto dentro de geometria poligonal. */
export const pointInGeometry = (p, g) => (isPolygonal(g) ? pointInFeature(p, { geometry: g }) : false);

/**
 * Teste ponto-no-polígono preparado para muitas consultas (centenas de
 * milhares de pontos contra um polígono com milhares de vértices).
 * As arestas são distribuídas em faixas horizontais: cada consulta só olha
 * as arestas da faixa do ponto (regra par-ímpar; buracos e multipolígonos ok).
 * @returns {(p: [number, number]) => boolean}
 */
export function preparePointInPolygon(g) {
  const edges = [];
  polygonsOf(g).forEach((poly) => poly.forEach((ring) => {
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1];
      const b = ring[i];
      if (a[1] !== b[1]) edges.push(a[0], a[1], b[0], b[1]);
    }
  }));
  const n = edges.length / 4;
  const [minX, minY, maxX, maxY] = geometryBboxAny(g);
  const bands = Math.max(1, Math.min(4096, Math.ceil(n / 4)));
  const h = (maxY - minY) / bands || 1;
  const buckets = Array.from({ length: bands }, () => []);
  for (let e = 0; e < n; e += 1) {
    const y0 = Math.min(edges[e * 4 + 1], edges[e * 4 + 3]);
    const y1 = Math.max(edges[e * 4 + 1], edges[e * 4 + 3]);
    const b0 = Math.max(0, Math.floor((y0 - minY) / h));
    const b1 = Math.min(bands - 1, Math.floor((y1 - minY) / h));
    for (let b = b0; b <= b1; b += 1) buckets[b].push(e);
  }
  return ([x, y]) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const bucket = buckets[Math.min(bands - 1, Math.floor((y - minY) / h))];
    let inside = false;
    for (let k = 0; k < bucket.length; k += 1) {
      const o = bucket[k] * 4;
      const xi = edges[o]; const yi = edges[o + 1]; const xj = edges[o + 2]; const yj = edges[o + 3];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** Ponto representativo simples (centro da caixa do maior polígono; se cair fora, o 1º vértice). */
export function labelPoint(g) {
  const polys = polygonsOf(g);
  if (!polys.length) return null;
  let best = polys[0];
  let bestArea = -1;
  polys.forEach((poly) => {
    const a = areaM2({ type: 'Polygon', coordinates: poly });
    if (a > bestArea) { bestArea = a; best = poly; }
  });
  const [minX, minY, maxX, maxY] = geometryBboxAny({ type: 'Polygon', coordinates: best });
  const c = [(minX + maxX) / 2, (minY + maxY) / 2];
  return pointInGeometry(c, { type: 'Polygon', coordinates: best }) ? c : best[0][0];
}
