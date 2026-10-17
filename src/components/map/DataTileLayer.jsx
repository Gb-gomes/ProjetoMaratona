import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { request } from '../../lib/layers/workerClient.js';
// Mesmo valor de TILE_EXTENT em lib/layers/dataEngine.js (não importado para não trazer o motor ao pacote principal).
const TILE_EXTENT = 4096;

/** Acrescenta o símbolo de um ponto ao caminho atual do canvas (sem beginPath). */
export function addSymbol(ctx, symbol, x, y, r) {
  if (symbol === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (symbol === 'triangle') {
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r * 1.05, y + r * 0.8);
    ctx.lineTo(x - r * 1.05, y + r * 0.8);
    ctx.closePath();
  } else if (symbol === 'diamond') {
    ctx.moveTo(x, y - r * 1.25);
    ctx.lineTo(x + r * 1.25, y);
    ctx.lineTo(x, y + r * 1.25);
    ctx.lineTo(x - r * 1.25, y);
    ctx.closePath();
  } else {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Camada de "vector tiles" locais: pede cada tile ao Web Worker e desenha
 * no canvas com o estilo da camada (inclusive por atributo).
 */
const CanvasTiles = L.GridLayer.extend({
  initialize(options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._styleFn = options.styleFn;
  },

  setStyleFn(fn, fields) {
    this._styleFn = fn;
    this.options.fields = fields;
    this.redraw();
  },

  setSource(source) {
    this.options.source = source;
    this.redraw();
  },

  createTile(coords, done) {
    const tile = L.DomUtil.create('canvas', 'cr-data-tile');
    const size = this.getTileSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tile.width = size.x * dpr;
    tile.height = size.y * dpr;
    tile.style.width = `${size.x}px`;
    tile.style.height = `${size.y}px`;
    const { source, fields } = this.options;
    request('tile', {
      ...source, z: coords.z, x: coords.x, y: coords.y, fields,
    })
      .then(({ tile: t }) => {
        if (t?.n) this._draw(tile.getContext('2d'), t, (size.x * dpr) / TILE_EXTENT, dpr);
        done(null, tile);
      })
      .catch((err) => done(err, tile));
    return tile;
  },

  /**
   * Desenho agrupado por estilo: cada grupo de linhas ou de pontos vira um
   * único caminho do canvas (um fill/stroke por estilo, não por feição), o que
   * mantém tiles com dezenas de milhares de pontos em poucos milissegundos.
   * Polígonos são preenchidos um a um (regra par-ímpar por feição).
   */
  _draw(ctx, t, s, dpr) {
    const styleFn = this._styleFn;
    const fieldNames = Object.keys(t.values);
    const props = {};
    const groups = new Map(); // estilo → { polys: [], lines: [], points: [] }
    for (let i = 0; i < t.n; i += 1) {
      for (let k = 0; k < fieldNames.length; k += 1) props[fieldNames[k]] = t.values[fieldNames[k]][i];
      const st = styleFn(props);
      let g = groups.get(st);
      if (!g) { g = { polys: [], lines: [], points: [] }; groups.set(st, g); }
      (t.types[i] === 1 ? g.points : t.types[i] === 2 ? g.lines : g.polys).push(i);
    }
    const tracePath = (i, close) => {
      for (let p = t.featPart[i]; p < t.featPart[i + 1]; p += 1) {
        const a = t.parts[p] * 2;
        const b = t.parts[p + 1] * 2;
        for (let c = a; c < b; c += 2) {
          const x = t.coords[c] * s;
          const y = t.coords[c + 1] * s;
          if (c === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (close) ctx.closePath();
      }
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Ordem: polígonos, linhas, pontos (pontos por cima).
    groups.forEach((g, st) => {
      g.polys.forEach((i) => {
        ctx.beginPath();
        tracePath(i, true);
        ctx.fillStyle = hexToRgba(st.color, st.fillOpacity ?? 0.25);
        ctx.fill('evenodd');
        ctx.strokeStyle = st.color;
        ctx.lineWidth = Math.max(0.5, (st.weight || 1.5) * dpr);
        ctx.stroke();
      });
    });
    groups.forEach((g, st) => {
      if (!g.lines.length) return;
      ctx.beginPath();
      g.lines.forEach((i) => tracePath(i, false));
      ctx.strokeStyle = st.color;
      ctx.lineWidth = Math.max(0.5, (st.weight || 1.5) * dpr);
      ctx.stroke();
    });
    groups.forEach((g, st) => {
      if (!g.points.length) return;
      const r = Math.max(1.5, st.radius || 4) * dpr;
      ctx.beginPath();
      g.points.forEach((i) => {
        for (let p = t.featPart[i]; p < t.featPart[i + 1]; p += 1) {
          const c = t.parts[p] * 2;
          addSymbol(ctx, st.symbol, t.coords[c] * s, t.coords[c + 1] * s, r);
        }
      });
      ctx.fillStyle = st.color;
      ctx.fill();
      // Contorno claro só quando os símbolos são grandes e poucos (custo e legibilidade).
      if (r >= 3 * dpr && g.points.length < 4000) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(0.75, dpr * 0.9);
        ctx.stroke();
      }
    });
  },
});

/**
 * @param source { layerId, version, regionKey }
 */
export default function DataTileLayer({
  source, styleFn, fields, pane, minZoom, maxZoom,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const sourceKey = `${source.layerId}@${source.version}#${source.regionKey ?? ''}`;

  useEffect(() => {
    const layer = new CanvasTiles({
      source, styleFn, fields, pane, minZoom: minZoom ?? 0, maxZoom: maxZoom ?? 22, updateWhenZooming: false, keepBuffer: 1,
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => { layer.remove(); layerRef.current = null; };
    // Recriada quando muda o pane ou os limites de zoom; estilo e fonte são atualizados abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pane, minZoom, maxZoom]);

  useEffect(() => { layerRef.current?.setStyleFn(styleFn, fields); }, [styleFn, fields]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { layerRef.current?.setSource(source); }, [sourceKey]);
  return null;
}
