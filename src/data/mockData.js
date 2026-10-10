/**
 * DADOS DEMONSTRATIVOS — TODOS FICTÍCIOS.
 *
 * Este módulo centraliza:
 *  1. As informações do desligamento programado.
 *  2. Uma malha territorial ILUSTRATIVA, no formato GeoJSON.
 *  3. Os 100 pontos da demonstração, gerados de forma determinística.
 *  4. A associação predefinida de cada ponto a uma unidade territorial.
 *
 * Nenhuma geometria aqui representa fronteiras oficiais. Para usar a malha
 * oficial do IBGE, substitua DEMO_TERRITORIES por uma FeatureCollection real
 * (mesma estrutura de `properties`) e TERRITORIAL_LAYER em config.js.
 */
import { DEMO_AREA } from '../config.js';
import { pointInFeature, ringCentroid } from '../lib/geo.js';
import { PROPERTY_NAMES, FIRST_PROPERTIES } from './demoNames.js';

/* ------------------------------------------------------------------ */
/* 1. Desligamento programado                                         */
/* ------------------------------------------------------------------ */
export const OUTAGE = {
  id: 'DP-2026-CAT04-0187',
  feeder: 'CAT-04',
  reason: 'Manutenção preventiva da rede (demonstração)',
  scheduledOn: '05/10/2026',
  dateLabel: '20/10/2026',
  dateLong: '20 de outubro de 2026',
  start: '13h',
  end: '17h',
  noticeDate: '15/10/2026',
  letterDate: '20 OUTUBRO 2026',
  letterStart: '13:00h',
  letterEnd: '17:00h',
  audience: 'MUNICÍPIO DEMONSTRATIVO',
  noticeDaysBefore: 5,
  planningDaysBefore: 15,
};

export const DEMO_FILE_NAME = 'desligamento_alimentador_CAT04.csv';

/* ------------------------------------------------------------------ */
/* Gerador pseudoaleatório com semente: mesmo resultado a cada carga. */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 2. Malha territorial ILUSTRATIVA                                   */
/*    Grade irregular 4 × 3 com arestas compartilhadas: as unidades   */
/*    se encaixam sem buracos nem sobreposição, como uma malha real.   */
/* ------------------------------------------------------------------ */
const COLS = 4;
const ROWS = 3;

/** Unidades com nome na demonstração (posição na grade → nome). */
const NAMED_UNITS = {
  '0,1': { name: 'São Pedro', order: 1 },
  '0,2': { name: 'Boa Vista', order: 2 },
  '1,1': { name: 'Santa Rita', order: 3 },
  '1,2': { name: 'Água Limpa', order: 4 },
};

function buildDemoTerritories() {
  const rand = mulberry32(4410);
  const { west, east, south, north } = DEMO_AREA;
  const cw = (east - west) / COLS;
  const ch = (north - south) / ROWS;

  // Vértices da grade, deslocados para formar limites irregulares.
  const V = [];
  for (let r = 0; r <= ROWS; r += 1) {
    V[r] = [];
    for (let c = 0; c <= COLS; c += 1) {
      let x = west + c * cw;
      let y = north - r * ch;
      if (c > 0 && c < COLS) x += (rand() - 0.5) * cw * 0.45;
      if (r > 0 && r < ROWS) y += (rand() - 0.5) * ch * 0.45;
      V[r][c] = [x, y];
    }
  }

  // Arestas subdivididas e compartilhadas entre unidades vizinhas.
  const cache = new Map();
  const edge = (r1, c1, r2, c2) => {
    const k1 = `${r1},${c1}`;
    const k2 = `${r2},${c2}`;
    const forward = k1 < k2;
    const key = forward ? `${k1}|${k2}` : `${k2}|${k1}`;
    if (!cache.has(key)) {
      const [A, B] = forward ? [V[r1][c1], V[r2][c2]] : [V[r2][c2], V[r1][c1]];
      const onBorder = (r1 === r2 && (r1 === 0 || r1 === ROWS)) || (c1 === c2 && (c1 === 0 || c1 === COLS));
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      const pts = [A];
      const n = 7;
      for (let i = 1; i < n; i += 1) {
        const t = i / n;
        const amp = onBorder ? 0 : (rand() - 0.5) * 0.12 * len * Math.sin(t * Math.PI) * 2;
        pts.push([A[0] + dx * t - (dy / len) * amp, A[1] + dy * t + (dx / len) * amp]);
      }
      pts.push(B);
      cache.set(key, pts);
    }
    const pts = cache.get(key);
    return forward ? pts : [...pts].reverse();
  };

  const round = ([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))];
  const features = [];
  let seq = 1;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ring = [
        ...edge(r, c, r, c + 1),
        ...edge(r, c + 1, r + 1, c + 1).slice(1),
        ...edge(r + 1, c + 1, r + 1, c).slice(1),
        ...edge(r + 1, c, r, c).slice(1),
      ].map(round);
      const named = NAMED_UNITS[`${r},${c}`];
      const code = `DEMO-UT-${String(seq).padStart(2, '0')}`;
      features.push({
        type: 'Feature',
        properties: {
          id: code,
          code,
          name: named ? named.name : `Unidade ${String(seq).padStart(2, '0')}`,
          label: named ? `Região demonstrativa ${named.name}` : `Unidade demonstrativa ${String(seq).padStart(2, '0')}`,
          order: named ? named.order : 100 + seq,
          demo: true,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      seq += 1;
    }
  }
  return { type: 'FeatureCollection', name: 'demo_unidades_territoriais', features };
}

export const DEMO_TERRITORIES = buildDemoTerritories();

/* ------------------------------------------------------------------ */
/* 3. Pontos da demonstração (100), dentro das unidades nomeadas       */
/* ------------------------------------------------------------------ */

/** Distribuição obrigatória: 24 + 31 + 28 + 17 = 100. */
export const DEMO_DISTRIBUTION = [
  { name: 'São Pedro', count: 24 },
  { name: 'Boa Vista', count: 31 },
  { name: 'Santa Rita', count: 28 },
  { name: 'Água Limpa', count: 17 },
];

function buildDemoPoints() {
  const rand = mulberry32(20261020);
  const points = [];
  let nameIndex = 0;

  DEMO_DISTRIBUTION.forEach(({ name, count }) => {
    const feature = DEMO_TERRITORIES.features.find((f) => f.properties.name === name);
    const ring = feature.geometry.coordinates[0];
    const [cx, cy] = ringCentroid(ring);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 50000) {
      attempts += 1;
      const lng = x0 + rand() * (x1 - x0);
      const lat = y0 + rand() * (y1 - y0);
      if (!pointInFeature([lng, lat], feature)) continue;
      // Reserva espaço para o rótulo da região no centro do polígono.
      if (Math.abs(lng - cx) < 0.032 && Math.abs(lat - cy) < 0.01) continue;
      // Evita pontos sobrepostos.
      if (points.some((p) => Math.hypot(p.lng - lng, p.lat - lat) < 0.0062)) continue;

      const property = nameIndex < FIRST_PROPERTIES.length
        ? FIRST_PROPERTIES[nameIndex]
        : PROPERTY_NAMES[nameIndex - FIRST_PROPERTIES.length];
      nameIndex += 1;

      points.push({
        id: `PT-${String(points.length + 1).padStart(3, '0')}`,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        propertyType: property.type,
        propertyName: property.name,
        // Associação PREDEFINIDA usada pela simulação (ver mockSpatialJoin).
        demoUnitId: feature.properties.id,
      });
      placed += 1;
    }
    if (placed < count) {
      throw new Error(`Não foi possível posicionar ${count} pontos em ${name}.`);
    }
  });
  return points;
}

export const DEMO_POINTS = buildDemoPoints();
