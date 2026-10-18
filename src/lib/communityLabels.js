/**
 * Quais nomes de comunidade cabem no mapa num dado zoom, sem um encavalar no outro.
 *
 * - Prioridade: a comunidade selecionada, depois as maiores.
 * - Um nome entra se a comunidade tem área na tela para ele (área do polígono em
 *   pixels >= área da caixa do texto × AREA_FACTOR) e se a caixa não bate em
 *   nenhuma já colocada (com folga de PAD px).
 * - Abaixo de MIN_ZOOM nada aparece (de muito longe vira só cor).
 *
 * Módulo puro: recebe a projeção (latlng → pixel absoluto no zoom) de fora.
 */

export const MIN_ZOOM = 8;
const AREA_FACTOR = 0.3;
const PAD = 2;
const CHAR_PX = 6.8; // 12 px, negrito
const BOX_H = 15;
const CELL = 64;
const KM_PER_PX_Z0 = 156.543;

export const labelBoxWidth = (name) => Math.round(String(name).length * CHAR_PX + 6);

/**
 * @param {{id, name, labelPoint: [lng, lat], areaKm2}[]} regions
 * @param {number} zoom
 * @param {(lat: number, lng: number) => {x: number, y: number}} project
 * @param {{ selectedId?: string }} opts
 * @returns {Set<string>} ids que recebem nome
 */
export function placeCommunityLabels(regions, zoom, project, { selectedId = null } = {}) {
  const out = new Set();
  if (zoom < MIN_ZOOM) {
    if (selectedId) out.add(selectedId);
    return out;
  }
  const grid = new Map();
  const cellsOf = (b) => {
    const keys = [];
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx += 1) {
      for (let cy = Math.floor(b.y0 / CELL); cy <= Math.floor(b.y1 / CELL); cy += 1) keys.push(`${cx}:${cy}`);
    }
    return keys;
  };
  const hits = (b) => cellsOf(b).some((k) => (grid.get(k) ?? []).some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0));
  const put = (b) => cellsOf(b).forEach((k) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); });

  const list = regions
    .filter((r) => r.labelPoint)
    .sort((a, b) => (b.id === selectedId) - (a.id === selectedId) || (b.areaKm2 ?? 0) - (a.areaKm2 ?? 0));
  list.forEach((r) => {
    const w = labelBoxWidth(r.name);
    const selected = r.id === selectedId;
    if (!selected && r.areaKm2) {
      const kmPx = (KM_PER_PX_Z0 * Math.cos((r.labelPoint[1] * Math.PI) / 180)) / 2 ** zoom;
      if (r.areaKm2 / (kmPx * kmPx) < w * BOX_H * AREA_FACTOR) return;
    }
    const p = project(r.labelPoint[1], r.labelPoint[0]);
    const b = {
      x0: p.x - w / 2 - PAD, x1: p.x + w / 2 + PAD, y0: p.y - BOX_H / 2 - PAD, y1: p.y + BOX_H / 2 + PAD,
    };
    if (!selected && hits(b)) return;
    put(b);
    out.add(r.id);
  });
  return out;
}
