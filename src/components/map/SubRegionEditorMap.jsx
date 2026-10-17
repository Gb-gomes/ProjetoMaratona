import { useEffect, useMemo, useRef } from 'react';
import { Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { geometryToLatLngs } from '../../lib/geo.js';
import { polygonsOf } from '../../lib/geoOps.js';

const WORLD = [[-89.9, -179.9], [89.9, -179.9], [89.9, 179.9], [-89.9, 179.9]];
const DRAFT_PANE = 'cr-editor-draft';
const MASK_PANE = 'cr-editor-mask';

/**
 * O Geoman só prepara mapas criados depois de ser importado. Como este
 * componente é carregado sob demanda, o mapa já existe: liga-o aqui
 * (mesma inicialização do hook do Geoman).
 */
function ensureGeoman(map) {
  if (!map.pm) {
    map.pm = new L.PM.Map(map);
    map.pm.setGlobalOptions({});
  }
}

function ensurePanes(map) {
  if (!map.getPane(MASK_PANE)) {
    const mask = map.createPane(MASK_PANE);
    mask.style.zIndex = '592';
    mask.style.pointerEvents = 'none'; // a máscara não pode bloquear cliques
  }
  if (!map.getPane(DRAFT_PANE)) map.createPane(DRAFT_PANE).style.zIndex = '596';
}

/** Leaflet polygon(s) → geometria GeoJSON (MultiPolygon). */
function layerToGeometry(layer) {
  const gj = layer.toGeoJSON();
  const g = gj.type === 'FeatureCollection' ? gj.features[0]?.geometry : gj.geometry;
  if (!g) return null;
  return g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g;
}

/**
 * Parte do editor que vive dentro do mapa:
 * - escurece tudo fora da região-mãe e destaca o contorno (alvo de snapping);
 * - desenho de polígono/retângulo e edição de vértices (Leaflet-Geoman);
 * - seleção de municípios/setores por clique.
 */
export default function SubRegionEditorMap({
  editor, units = [], onGeometry, onToggleUnit, onToolDone,
}) {
  const map = useMap();
  ensureGeoman(map);
  ensurePanes(map);
  const draftRef = useRef(null);
  const onGeometryRef = useRef(onGeometry);
  onGeometryRef.current = onGeometry;
  const onToolDoneRef = useRef(onToolDone);
  onToolDoneRef.current = onToolDone;

  const parentGeom = editor.parent.geometry;
  const maskPositions = useMemo(
    () => [WORLD, ...polygonsOf(parentGeom).map((poly) => poly[0].map(([x, y]) => [y, x]))],
    [parentGeom],
  );

  // Idioma e opções globais do Geoman.
  useEffect(() => {
    map.pm.setLang('pt_br');
    map.pm.setGlobalOptions({
      snappable: true, snapDistance: 18, snapSegment: true, allowSelfIntersection: false, panes: { layerPane: DRAFT_PANE, vertexPane: 'markerPane', markerPane: 'markerPane' },
      templineStyle: { color: '#EE7A12' }, hintlineStyle: { color: '#EE7A12', dashArray: '4 4' }, pathOptions: { color: '#EE7A12', weight: 2.5 },
    });
    const onCreate = (e) => {
      const geometry = layerToGeometry(e.layer);
      e.layer.remove();
      if (geometry) onGeometryRef.current(geometry, { from: 'draw' });
      onToolDoneRef.current?.();
    };
    map.on('pm:create', onCreate);
    return () => {
      map.off('pm:create', onCreate);
      map.pm.disableDraw();
    };
  }, [map]);

  // Ferramenta ativa de desenho.
  useEffect(() => {
    map.pm.disableDraw();
    if (editor.tool === 'polygon') map.pm.enableDraw('Polygon', { finishOn: null, continueDrawing: false });
    if (editor.tool === 'rectangle') map.pm.enableDraw('Rectangle', { continueDrawing: false });
  }, [map, editor.tool]);

  // Rascunho editável (desenho, importação, edição de geometria).
  const editable = editor.method === 'drawn' || editor.method === 'imported';
  const draftKey = `${editor.draftNonce}|${editable}`;
  useEffect(() => {
    draftRef.current?.remove();
    draftRef.current = null;
    if (!editor.geometry || !editable) return undefined;
    const layer = L.polygon(geometryToLatLngs(editor.geometry), {
      pane: DRAFT_PANE, color: '#EE7A12', weight: 2.5, fillColor: '#EE7A12', fillOpacity: 0.18, pmIgnore: false,
    }).addTo(map);
    layer.pm.enable({
      allowSelfIntersection: false, snappable: true, snapDistance: 18, draggable: false, removeLayerBelowMinVertexCount: false,
    });
    const sync = () => onGeometryRef.current(layerToGeometry(layer), { from: 'edit' });
    layer.on('pm:edit pm:vertexremoved pm:vertexadded pm:markerdragend', sync);
    draftRef.current = layer;
    return () => {
      layer.off();
      layer.pm.disable();
      layer.remove();
    };
    // O rascunho é recriado só quando a geometria vem de fora (draftNonce), não a cada vértice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, draftKey]);

  const selection = useMemo(() => new Set(editor.selection ?? []), [editor.selection]);
  const selecting = editor.method === 'municipalities' || editor.method === 'sectors';

  return (
    <>
      <Polygon
        positions={maskPositions}
        pane={MASK_PANE}
        interactive={false}
        pmIgnore
        // Escuro e forte o bastante para aparecer também no tema escuro.
        pathOptions={{ stroke: false, fillColor: '#020617', fillOpacity: 0.62 }}
      />
      <Polygon
        positions={geometryToLatLngs(parentGeom)}
        pane={MASK_PANE}
        interactive={false}
        pmIgnore={false}
        pathOptions={{ color: '#EE7A12', weight: 3, fill: false, dashArray: '2 6', lineCap: 'round' }}
      />
      {selecting && units.map((u) => {
        const on = selection.has(u.code);
        return (
          <Polygon
            key={u.code}
            positions={geometryToLatLngs(u.geometry)}
            pane={DRAFT_PANE}
            pmIgnore
            bubblingMouseEvents={false}
            eventHandlers={{ click: () => onToggleUnit(u.code) }}
            pathOptions={{
              color: on ? '#EE7A12' : '#F59E0B', weight: on ? 2.2 : 1, opacity: on ? 1 : 0.75, dashArray: on ? null : '3 3', fillColor: '#EE7A12', fillOpacity: on ? 0.4 : 0.06,
            }}
          >
            <Tooltip sticky className="cr-point-tip">
              {u.label}
              <br />
              {on ? 'Selecionado — clique para retirar' : 'Clique para incluir'}
            </Tooltip>
          </Polygon>
        );
      })}
      {selecting && editor.geometry && (
        <Polygon
          positions={geometryToLatLngs(editor.geometry)}
          pane={DRAFT_PANE}
          interactive={false}
          pmIgnore
          pathOptions={{ color: '#EE7A12', weight: 3, fill: false }}
        />
      )}
    </>
  );
}
