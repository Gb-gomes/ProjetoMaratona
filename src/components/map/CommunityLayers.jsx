import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Polygon, Marker, useMap, useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { paneName } from './PaneManager.jsx';
import { useZoom } from './OrgLayers.jsx';
import { geometryToLatLngs } from '../../lib/geo.js';
import { COMMUNITY_COLOR, confidenceReason } from '../../lib/communities.js';
import { URBAN_FILL } from '../../lib/communityColors.js';
import { placeCommunityLabels } from '../../lib/communityLabels.js';

const labelCache = new Map();
function labelIcon(name, low, selected) {
  const key = `${name}|${low}|${selected}`;
  if (!labelCache.has(key)) {
    const span = document.createElement('span');
    span.className = `cr-community-label${low ? ' is-low' : ''}${selected ? ' is-selected' : ''}`;
    span.textContent = name;
    labelCache.set(key, L.divIcon({ className: 'cr-community-icon', html: span.outerHTML, iconSize: null }));
  }
  return labelCache.get(key);
}

const ringsOf = (g) => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const LABEL_PANE = 'cr-community-labels';
const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * Comunidades de um município, no estilo do mapa de referência aprovado:
 * - preenchimento pastel, vizinhas com cores diferentes (lib/communityColors.js);
 * - área urbana (o que sobra do município fora das comunidades) em cinza;
 * - contorno fino; tracejado quando a confiança é baixa;
 * Os nomes ficam em CommunityLabels (um componente só para todos os municípios).
 * Ao aproximar e ao editar, o preenchimento fica mais leve para o mapa base aparecer.
 * Os polígonos não são interativos: clique e destaque são feitos pelo mapa
 * (MapClickRouter e CommunityHover), para não bloquear as camadas de baixo.
 */
export function CommunitiesLayer({
  layer, regions, colors = null, municipality = null, editing = false, hoveredId = null, selectedId = null,
}) {
  const zoom = useZoom();
  const pane = paneName(layer.id);
  const dark = isDark();
  // De longe, cores fortes como no mapa de referência; ao aproximar, o preenchimento clareia
  // para o mapa base (vias, nomes) aparecer e o operador se situar.
  const fade = zoom <= 11 ? 1 : zoom >= 14 ? 0.3 : 1 - ((zoom - 11) / 3) * 0.7;
  const fill = editing ? 0.15 : (dark ? 0.32 : 0.62) * fade;
  // Município com todos os anéis das comunidades como furos (regra par-ímpar do Leaflet):
  // o que sobra é a área fora das comunidades rurais, ou seja, a área urbana.
  const urban = useMemo(() => {
    if (!municipality) return null;
    return [...ringsOf(municipality), ...regions.flatMap((r) => ringsOf(r.geometry))]
      .map((ring) => ring.map(([x, y]) => [y, x]));
  }, [municipality, regions]);
  return (
    <>
      {urban && (
        <Polygon
          key={`urb-${layer.id}`}
          positions={urban}
          pane={pane}
          interactive={false}
          pmIgnore
          pathOptions={{
            stroke: false, fillRule: 'evenodd', fillColor: URBAN_FILL, fillOpacity: editing ? 0.12 : (dark ? 0.3 : 0.55) * fade,
          }}
        />
      )}
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
              color: on ? '#0B2233' : dark ? '#94A3B8' : '#4B5563',
              weight: on ? 2.6 : 0.8,
              dashArray: low ? '5 4' : null,
              opacity: on ? 1 : 0.75,
              fillColor: colors?.get(r.id) ?? COMMUNITY_COLOR,
              fillOpacity: on ? Math.min(0.85, fill + 0.2) : fill,
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Nomes das comunidades de todos os municípios visíveis, num pane próprio acima dos
 * polígonos (senão o município vizinho cobre os nomes perto da divisa).
 * - Escolha dos nomes por zoom (placeCommunityLabels): o máximo que cabe sem encavalar,
 *   maiores primeiro; de muito longe (zoom < 8) nenhum.
 * - Só os que estão na tela (com folga) viram elementos, para não pesar.
 */
export function CommunityLabels({ regions, selectedId = null }) {
  const map = useMap();
  if (!map.getPane(LABEL_PANE)) {
    const el = map.createPane(LABEL_PANE);
    el.style.zIndex = '592';
    el.style.pointerEvents = 'none';
  }
  const zoom = useZoom();
  const [view, setView] = useState(() => map.getBounds().pad(0.25));
  useMapEvents({ moveend: () => setView(map.getBounds().pad(0.25)) });
  const zInt = Math.round(zoom * 4) / 4;
  const placed = useMemo(
    () => placeCommunityLabels(regions, zInt, (lat, lng) => map.project([lat, lng], zInt), { selectedId }),
    [regions, zInt, selectedId, map],
  );
  return regions
    .filter((r) => placed.has(r.id) && view.contains([r.labelPoint[1], r.labelPoint[0]]))
    .map((r) => (
      <Marker
        key={`lb-${r.id}:${r.updatedAt}`}
        position={[r.labelPoint[1], r.labelPoint[0]]}
        icon={labelIcon(r.name, r.confidence === 'baixa', r.id === selectedId)}
        pane={LABEL_PANE}
        interactive={false}
        keyboard={false}
        pmIgnore
      />
    ));
}

/**
 * Destaque ao passar o mouse: usa o serviço de nomes (o mesmo de todo o
 * sistema) e mostra comunidade, distrito, município e confiança.
 */
export function CommunityHover({
  enabled, locator, visibleMunicipalities, regionsById, onHover, hiddenIds = {},
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
        if (!c || !visible.has(place.municipio?.cod) || place.origem_nome !== 'comunidade' || hiddenIds[c.regionId]) { hide(); return; }
        if (last.current !== c.regionId) { last.current = c.regionId; onHover(c.regionId); }
        const box = document.createElement('div');
        const line = (cls, text) => { const el = document.createElement('span'); el.className = cls; el.textContent = text; return el; };
        const mun = `${place.municipio.nome}${place.municipio.uf ? `/${place.municipio.uf}` : ''}`;
        const dist = place.distrito && (place.distrito.sede ? 'Distrito-sede' : `Distrito de ${place.distrito.nome}`);
        box.append(
          line('cr-tip-title', c.nome),
          line('cr-tip-sub', [mun, dist].filter(Boolean).join(' · ')),
          line(`cr-tip-status${c.aproximada ? ' is-low' : ''}`, c.aproximada ? 'Localização aproximada' : 'Localização confiável'),
        );
        if (c.aproximada) box.append(line('cr-tip-note', confidenceReason(regionsById.get(c.regionId))));
        if (!tipRef.current) tipRef.current = L.tooltip({ direction: 'top', offset: [0, -12], className: 'cr-point-tip', opacity: 1 });
        tipRef.current.setLatLng(e.latlng).setContent(box);
        if (!map.hasLayer(tipRef.current)) tipRef.current.addTo(map);
      });
    },
    mouseout: hide,
    zoomstart: hide,
  });
  return null;
}
