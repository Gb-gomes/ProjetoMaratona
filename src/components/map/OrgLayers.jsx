import {
  useContext, useEffect, useMemo, useState,
} from 'react';
import {
  Polygon, TileLayer, WMSTileLayer, Tooltip, useMap, useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import DataTileLayer from './DataTileLayer.jsx';
import { MapChromeContext, desktopPadding } from './MapLayersDock.jsx';
import { paneName } from './PaneManager.jsx';
import { geometryToLatLngs } from '../../lib/geo.js';
import { compileStyle, styleFields } from '../../lib/layers/layerModel.js';
import { request } from '../../lib/layers/workerClient.js';
import { pointInGeometry, bboxIntersects } from '../../lib/geoOps.js';

/** Zoom atual do mapa (para limites de zoom por camada e rótulos). */
export function useZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

const inZoom = (layer, zoom) => (layer.minZoom == null || zoom >= layer.minZoom) && (layer.maxZoom == null || zoom <= layer.maxZoom);

/** Limites oficiais do IBGE (somente leitura; o clique é tratado pelo MapClickRouter). */
export function IbgeLevelLayer({ layer, regions, highlightCode = null }) {
  const pane = paneName(layer.id);
  const { color, weight, dash } = layer.levelStyle;
  return regions.map((r) => (
    <Polygon
      key={r.code}
      positions={geometryToLatLngs(r.geometry)}
      pane={pane}
      interactive={false}
      pmIgnore
      pathOptions={{
        color, weight: r.code === highlightCode ? weight + 1.6 : weight, dashArray: dash, fill: r.code === highlightCode, fillColor: color, fillOpacity: 0.08,
      }}
    />
  ));
}

/** Sub-regiões da organização, com rótulo a partir do zoom 11. */
export function CustomRegionsLayer({
  layer, regions, selectedId = null, editingId = null, filterRegionId = null,
}) {
  const zoom = useZoom();
  const pane = paneName(layer.id);
  return regions.filter((r) => r.id !== editingId).map((r) => {
    const selected = r.id === selectedId;
    const dimmed = filterRegionId && r.id !== filterRegionId;
    return (
      <Polygon
        key={`${r.id}:${r.updatedAt}`}
        positions={geometryToLatLngs(r.geometry)}
        pane={pane}
        interactive={false}
        pmIgnore={false}
        pathOptions={{
          color: r.color,
          weight: selected ? 3.2 : 1.8,
          fillColor: r.color,
          fillOpacity: dimmed ? 0.04 : selected ? 0.32 : 0.16,
          opacity: dimmed ? 0.5 : 1,
        }}
      >
        {zoom >= 11 && (
          <Tooltip permanent direction="center" className="cr-subregion-label" interactive={false}>
            <span className={`cr-subregion-chip ${selected ? 'is-selected' : ''}`} style={{ '--c': r.color }}>{r.name}</span>
          </Tooltip>
        )}
      </Polygon>
    );
  });
}

/** Camada de dados importada (tiles locais via Web Worker). */
export function DataLayer({ layer, filterKey }) {
  // Limites de zoom são aplicados pela própria GridLayer.
  const styleFn = useMemo(() => compileStyle(layer.style), [layer.style]);
  const fields = useMemo(() => styleFields(layer.style), [layer.style]);
  return (
    <DataTileLayer
      source={{ layerId: layer.id, version: layer.currentVersion, regionKey: filterKey ?? null }}
      styleFn={styleFn}
      fields={fields}
      pane={paneName(layer.id)}
      minZoom={layer.minZoom ?? undefined}
      maxZoom={layer.maxZoom ?? undefined}
    />
  );
}

/** WMS ou XYZ por URL (imagens; permitidas pela CSP). */
export function ExternalLayer({ layer }) {
  const ext = layer.external ?? {};
  const pane = paneName(layer.id);
  if (ext.type === 'wms') {
    return (
      <WMSTileLayer
        url={ext.url}
        pane={pane}
        params={{
          layers: ext.layers, format: ext.format || 'image/png', transparent: true, version: ext.version || '1.1.1',
        }}
        attribution={ext.attribution}
        minZoom={layer.minZoom ?? 0}
        maxZoom={layer.maxZoom ?? 22}
      />
    );
  }
  return <TileLayer url={ext.url} pane={pane} attribution={ext.attribution} minZoom={layer.minZoom ?? 0} maxZoom={layer.maxZoom ?? 22} />;
}

/* ------------------------------------------------------------------ */
/* Cliques                                                             */
/* ------------------------------------------------------------------ */

const escapeRows = (properties) => {
  const table = document.createElement('table');
  table.className = 'cr-attr-table';
  Object.entries(properties).slice(0, 60).forEach(([k, v]) => {
    const tr = table.insertRow();
    const th = document.createElement('th');
    th.textContent = k;
    const td = tr.insertCell();
    td.textContent = v === null || v === undefined ? '—' : String(v);
    tr.prepend(th);
  });
  return table;
};

/**
 * Roteia o clique no mapa (modo real, fora da edição):
 *  1. feição de camada de dados visível (de cima para baixo) → popup com atributos;
 *  2. senão, sub-regiões e limites IBGE sob o ponto → onPick (cartão de seleção).
 * As camadas operacionais (pontos do CSV, prioritários, setores afetados)
 * tratam os próprios cliques e não chegam aqui.
 */
export function MapClickRouter({
  enabled, dataLayers, pickables, onPick,
}) {
  const map = useMap();
  useMapEvents({
    click: async (e) => {
      if (!enabled) return;
      const { lat, lng } = e.latlng;
      const zoom = map.getZoom();
      for (const l of dataLayers) {
        if (!inZoom(l, zoom)) continue;
        // eslint-disable-next-line no-await-in-loop
        const hit = await request('hit', {
          layerId: l.id, version: l.currentVersion, regionKey: l.filterKey ?? null, lng, lat, zoom,
        }).catch(() => null);
        if (hit) {
          const box = document.createElement('div');
          box.className = 'cr-attr-popup';
          const h = document.createElement('p');
          h.className = 'cr-attr-title';
          h.textContent = l.name;
          box.append(h, escapeRows(hit.properties));
          L.popup({ maxWidth: 320, maxHeight: 300, autoPanPadding: [24, 24] }).setLatLng(e.latlng).setContent(box).openOn(map);
          return;
        }
      }
      const p = [lng, lat];
      const items = pickables.filter((it) => bboxIntersects(it.bbox, [lng, lat, lng, lat]) && pointInGeometry(p, it.geometry));
      onPick(items.length ? { latlng: [lat, lng], items } : null);
    },
  });
  return null;
}

/** Voa até uma caixa pedida pela interface ("zoom para a camada", "ver no mapa"). */
export function CameraRequest({ request: req, compact, editing = false }) {
  const map = useMap();
  const { dockOpen } = useContext(MapChromeContext);
  useEffect(() => {
    if (!req?.bounds) return;
    // Folga para os painéis: camadas à esquerda (desktop), editor à direita (desktop) ou embaixo (celular).
    let padding;
    if (compact) padding = { paddingTopLeft: [16, 64], paddingBottomRight: [16, editing ? Math.round(map.getSize().y * 0.52) : 120] };
    else if (editing) padding = { paddingTopLeft: [32, 32], paddingBottomRight: [372, 32] };
    else padding = desktopPadding(dockOpen);
    map.flyToBounds(req.bounds, { ...padding, maxZoom: req.maxZoom ?? 15, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce]);
  return null;
}

/** Ajusta os limites de navegação quando a hierarquia do IBGE carrega. */
export function NavigationBounds({ maxBounds, minZoom }) {
  const map = useMap();
  useEffect(() => {
    if (maxBounds) map.setMaxBounds(maxBounds);
    if (minZoom != null) map.setMinZoom(minZoom);
  }, [map, maxBounds, minZoom]);
  return null;
}
