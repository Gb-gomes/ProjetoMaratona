import { useEffect, useMemo, useRef } from 'react';
import {
  Polygon, Marker, useMap, useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { paneName } from './PaneManager.jsx';
import { useZoom } from './OrgLayers.jsx';
import { geometryToLatLngs } from '../../lib/geo.js';
import { COMMUNITY_COLOR, confidenceReason } from '../../lib/communities.js';

const labelCache = new Map();
function labelIcon(name, low, selected) {
  const key = `${name}|${low}|${selected}`;
  if (!labelCache.has(key)) {
    const span = document.createElement('span');
    span.className = `cr-community-label${low ? ' is-low' : ''}${selected ? ' is-selected' : ''}`;
    span.textContent = low ? `${name} ≈` : name;
    labelCache.set(key, L.divIcon({ className: 'cr-community-icon', html: span.outerHTML, iconSize: null }));
  }
  return labelCache.get(key);
}

/**
 * Comunidades de um município: contorno fino; tracejado quando a confiança é
 * baixa (localização aproximada); rótulo no label_point a partir do zoom 11.
 * Os polígonos não são interativos: clique e destaque são feitos pelo mapa
 * (MapClickRouter e CommunityHover), para não bloquear as camadas de baixo.
 */
export function CommunitiesLayer({
  layer, regions, hoveredId = null, selectedId = null,
}) {
  const zoom = useZoom();
  const pane = paneName(layer.id);
  return (
    <>
      {regions.map((r) => {
        const low = r.confidence === 'baixa';
        const on = r.id === hoveredId || r.id === selectedId;
        return (
          <Polygon
            key={`${r.id}:${r.updatedAt}`}
            positions={geometryToLatLngs(r.geometry)}
            pane={pane}
            interactive={false}
            pmIgnore={false}
            pathOptions={{
              color: COMMUNITY_COLOR,
              weight: on ? 2.6 : 1,
              dashArray: low ? '5 4' : null,
              opacity: on ? 1 : 0.85,
              fillColor: COMMUNITY_COLOR,
              fillOpacity: on ? 0.2 : 0.04,
            }}
          />
        );
      })}
      {zoom >= 11 && regions.filter((r) => r.labelPoint).map((r) => (
        <Marker
          key={`lb-${r.id}:${r.updatedAt}`}
          position={[r.labelPoint[1], r.labelPoint[0]]}
          icon={labelIcon(r.name, r.confidence === 'baixa', r.id === selectedId)}
          pane={pane}
          interactive={false}
          keyboard={false}
          pmIgnore
        />
      ))}
    </>
  );
}

/**
 * Destaque ao passar o mouse: usa o serviço de nomes (o mesmo de todo o
 * sistema) e mostra comunidade, distrito, município e confiança.
 */
export function CommunityHover({
  enabled, locator, visibleMunicipalities, regionsById, onHover,
}) {
  const map = useMap();
  const tipRef = useRef(null);
  const frame = useRef(0);
  const last = useRef(null);
  const visible = useMemo(() => new Set(visibleMunicipalities), [visibleMunicipalities]);

  const hide = () => {
    tipRef.current?.remove();
    tipRef.current = null;
    if (last.current !== null) { last.current = null; onHover(null); }
  };
  useEffect(() => { if (!enabled) hide(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => hide, []); // eslint-disable-line react-hooks/exhaustive-deps

  useMapEvents({
    mousemove: (e) => {
      if (!enabled || !locator) return;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const place = locator.locate([e.latlng.lng, e.latlng.lat]);
        const c = place?.comunidade;
        if (!c || !visible.has(place.municipio?.cod) || place.origem_nome !== 'comunidade') { hide(); return; }
        if (last.current !== c.regionId) { last.current = c.regionId; onHover(c.regionId); }
        const box = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = c.nome;
        const where = document.createElement('div');
        where.textContent = [place.distrito && (place.distrito.sede ? `Distrito-sede (${place.distrito.nome})` : `Distrito de ${place.distrito.nome}`), `${place.municipio.nome}${place.municipio.uf ? `/${place.municipio.uf}` : ''}`].filter(Boolean).join(' · ');
        const conf = document.createElement('div');
        conf.className = c.aproximada ? 'cr-tip-low' : 'cr-tip-ok';
        conf.textContent = c.aproximada ? `Localização aproximada: ${confidenceReason(regionsById.get(c.regionId))}` : 'Confiança: boa';
        box.append(title, where, conf);
        if (!tipRef.current) tipRef.current = L.tooltip({ direction: 'top', offset: [0, -10], className: 'cr-point-tip cr-community-tip', opacity: 1 });
        tipRef.current.setLatLng(e.latlng).setContent(box);
        if (!map.hasLayer(tipRef.current)) tipRef.current.addTo(map);
      });
    },
    mouseout: hide,
    zoomstart: hide,
  });
  return null;
}
