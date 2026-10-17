/**
 * Correção e validação de geometrias (equivalente simplificado ao ST_MakeValid).
 * Módulo leve, sem leitores de arquivo: usado na importação de camadas
 * (Web Worker) e na importação de comunidades (thread principal).
 */
import { unionGeometries } from '../geoOps.js';

export const finitePair = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const dedupe = (coords) => coords.filter((c, i) => i === 0 || !samePoint(c, coords[i - 1])).map((c) => [c[0], c[1]]);

function cleanRing(ring) {
  if (!Array.isArray(ring) || !ring.every(finitePair)) return { ring: null, fixed: false };
  let r = dedupe(ring);
  let fixed = r.length !== ring.length;
  if (r.length && !samePoint(r[0], r[r.length - 1])) { r = [...r, r[0]]; fixed = true; }
  return { ring: r.length >= 4 ? r : null, fixed };
}

/* Detecção de autointerseção em um anel (índice de grade simples). */
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c); const o2 = o(a, b, d); const o3 = o(c, d, a); const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
export function ringSelfIntersects(ring) {
  const n = ring.length - 1;
  if (n < 4) return false;
  if (n <= 400) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue;
        if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
      }
    }
    return false;
  }
  // Anéis grandes: grade uniforme para limitar as comparações.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  const cells = Math.ceil(Math.sqrt(n));
  const cw = (maxX - minX) / cells || 1;
  const ch = (maxY - minY) / cells || 1;
  const grid = new Map();
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]; const b = ring[i + 1];
    const x0 = Math.floor((Math.min(a[0], b[0]) - minX) / cw); const x1 = Math.floor((Math.max(a[0], b[0]) - minX) / cw);
    const y0 = Math.floor((Math.min(a[1], b[1]) - minY) / ch); const y1 = Math.floor((Math.max(a[1], b[1]) - minY) / ch);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = gx * 100003 + gy;
        const list = grid.get(key);
        if (list) {
          for (const j of list) {
            const adjacent = Math.abs(i - j) <= 1 || (Math.min(i, j) === 0 && Math.max(i, j) === n - 1);
            if (!adjacent && segmentsCross(a, b, ring[j], ring[j + 1])) return true;
          }
          list.push(i);
        } else grid.set(key, [i]);
      }
    }
  }
  return false;
}

/**
 * Corrige o que for seguro e rejeita o resto (equivalente simplificado ao ST_MakeValid).
 * @returns {{ geometry: object|null, fixed: string|null, reason: string|null }}
 */
export function repairGeometry(g) {
  if (!g || !g.type) return { geometry: null, fixed: null, reason: 'Geometria ausente' };
  switch (g.type) {
    case 'Point':
      return finitePair(g.coordinates) ? { geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }, fixed: null, reason: null }
        : { geometry: null, fixed: null, reason: 'Coordenada inválida' };
    case 'MultiPoint': {
      const pts = (g.coordinates ?? []).filter(finitePair).map((c) => [c[0], c[1]]);
      if (!pts.length) return { geometry: null, fixed: null, reason: 'Coordenadas inválidas' };
      return { geometry: { type: 'MultiPoint', coordinates: pts }, fixed: pts.length !== g.coordinates.length ? 'pontos inválidos removidos' : null, reason: null };
    }
    case 'LineString':
    case 'MultiLineString': {
      const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates) ?? [];
      if (!lines.every((l) => Array.isArray(l) && l.every(finitePair))) return { geometry: null, fixed: null, reason: 'Coordenadas inválidas' };
      const kept = lines.map(dedupe).filter((l) => l.length >= 2);
      if (!kept.length) return { geometry: null, fixed: null, reason: 'Linha com menos de 2 pontos distintos' };
      const fixed = kept.length !== lines.length || kept.some((l, i) => l.length !== lines[i]?.length) ? 'vértices repetidos removidos' : null;
      return { geometry: kept.length === 1 ? { type: 'LineString', coordinates: kept[0] } : { type: 'MultiLineString', coordinates: kept }, fixed, reason: null };
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) ?? [];
      let fixedAny = false;
      const kept = [];
      for (const poly of polys) {
        const rings = (poly ?? []).map(cleanRing);
        if (rings.some((r) => r.fixed)) fixedAny = true;
        if (!rings[0]?.ring) { fixedAny = true; continue; }
        const holes = rings.slice(1).map((r) => r.ring).filter(Boolean);
        if (holes.length !== rings.length - 1) fixedAny = true;
        kept.push([rings[0].ring, ...holes]);
      }
      if (!kept.length) return { geometry: null, fixed: null, reason: 'Polígono com menos de 3 vértices distintos' };
      const geometry = kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept };
      if (kept.some((poly) => poly.some(ringSelfIntersects))) {
        try {
          const valid = unionGeometries([geometry]);
          if (!valid) return { geometry: null, fixed: null, reason: 'Autointerseção que não pôde ser corrigida' };
          return { geometry: valid.coordinates.length === 1 ? { type: 'Polygon', coordinates: valid.coordinates[0] } : valid, fixed: 'autointerseção corrigida', reason: null };
        } catch {
          return { geometry: null, fixed: null, reason: 'Autointerseção que não pôde ser corrigida' };
        }
      }
      return { geometry, fixed: fixedAny ? 'anéis fechados/vértices repetidos removidos' : null, reason: null };
    }
    case 'GeometryCollection':
      return { geometry: null, fixed: null, reason: 'GeometryCollection não é aceita (separe as geometrias)' };
    default:
      return { geometry: null, fixed: null, reason: `Tipo de geometria desconhecido: ${g.type}` };
  }
}

