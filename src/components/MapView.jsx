import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer, TileLayer, Polygon, CircleMarker, Marker, Polyline, Tooltip, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import {
  LoaderCircle, MapPinned, CircleAlert, TriangleAlert, FlaskConical, CircleCheck, Database,
} from 'lucide-react';
import LayerControl from './LayerControl.jsx';
import MapLegend from './MapLegend.jsx';
import StatusBadge from './StatusBadge.jsx';
import {
  DEMO_AREA, DEMO_AREA_MARGIN, TILE_LAYER, LAYER_BOUNDS_PADDING,
} from '../config.js';
import { geometryToLatLngs, mergeBounds, padBounds } from '../lib/geo.js';
import { BRAZIL_BBOX } from '../lib/csv.js';
import { pointsForMap } from '../lib/summary.js';
import { PRIORITY_CATEGORIES } from '../lib/priorityRecords.js';
import { MATCH_LABEL } from '../lib/priorityMatch.js';

const DEMO_BOUNDS = [[DEMO_AREA.south, DEMO_AREA.west], [DEMO_AREA.north, DEMO_AREA.east]];
const DEMO_MAX_BOUNDS = [
  [DEMO_AREA.south - DEMO_AREA_MARGIN, DEMO_AREA.west - DEMO_AREA_MARGIN],
  [DEMO_AREA.north + DEMO_AREA_MARGIN, DEMO_AREA.east + DEMO_AREA_MARGIN],
];
const BRAZIL_BOUNDS = [[BRAZIL_BBOX.minLat, BRAZIL_BBOX.minLng], [BRAZIL_BBOX.maxLat, BRAZIL_BBOX.maxLng]];
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Estilos das camadas                                                 */
/* ------------------------------------------------------------------ */
/** Cores do mapa por tema (Leaflet recebe cores em JS, fora do Tailwind). */
const MAP_PALETTE = {
  light: {
    idleStroke: '#94A3B8', idleFill: '#CBD5E1', idleOpacity: 0.25, focusStroke: '#0B2233', pointStroke: '#FFFFFF',
    points: { matched: '#112F44', unmatched: '#DC2626', ambiguous: '#D97706' },
  },
  dark: {
    idleStroke: '#5B7383', idleFill: '#2A4050', idleOpacity: 0.35, focusStroke: '#FFFFFF', pointStroke: '#0C1821',
    points: { matched: '#D6E6F0', unmatched: '#F87171', ambiguous: '#FBBF24' },
  },
};

function polygonStyle({
  affected, focused, dimmed, included, pal,
}) {
  if (!affected) {
    return {
      color: pal.idleStroke, weight: 1, dashArray: '3 3', fillColor: pal.idleFill, fillOpacity: pal.idleOpacity,
    };
  }
  if (focused) {
    return { color: pal.focusStroke, weight: 3, dashArray: null, fillColor: '#EE7A12', fillOpacity: 0.4 };
  }
  return {
    color: '#D9670A',
    weight: included ? 1.8 : 1.2,
    dashArray: included ? null : '6 4',
    fillColor: '#F5923A',
    fillOpacity: dimmed ? 0.1 : included ? 0.24 : 0.07,
    opacity: dimmed ? 0.6 : 1,
  };
}

function pointStyle({
  focused, dimmed, status = 'matched', pal,
}) {
  return {
    radius: focused ? 5.5 : status === 'matched' ? 4 : 5,
    color: pal.pointStroke,
    weight: 1.5,
    fillColor: pal.points[status],
    fillOpacity: dimmed ? 0.3 : 1,
    opacity: dimmed ? 0.45 : 1,
  };
}

/** Ícones DOM dos pontos prioritários (forma = categoria; anel = situação da análise). */
const prioIconCache = new Map();
function priorityIcon({ category, status, focused }) {
  const key = `${category}|${status ?? ''}|${focused ? 1 : 0}`;
  if (!prioIconCache.has(key)) {
    const cls = ['cr-prio-mark', `cat-${category}`, status ? `st-${status}` : '', focused ? 'is-focused' : '']
      .filter(Boolean).join(' ');
    prioIconCache.set(key, L.divIcon({
      className: 'cr-prio', html: `<div class="${cls}"><span>${category}</span></div>`, iconSize: [18, 18], iconAnchor: [9, 9],
    }));
  }
  return prioIconCache.get(key);
}

const STATUS_TEXT = { matched: null, unmatched: 'Sem correspondência territorial', ambiguous: 'Associação ambígua — revisar' };

/**
 * Controla a câmera do mapa a partir do estado da interface.
 * - Reajusta o tamanho do mapa quando o contêiner muda (layout responsivo).
 * - Voa até a área de interesse quando a fase ou a região em foco mudam.
 * A câmera é limitada por maxBounds no MapContainer.
 */
function MapController({ viewKey, targetBounds, maxZoom = 13 }) {
  const map = useMap();

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!targetBounds) return;
    const animate = !prefersReducedMotion();
    map.flyToBounds(targetBounds, {
      paddingTopLeft: [240, 56],
      paddingBottomRight: [32, 32],
      maxZoom,
      duration: animate ? 0.7 : 0,
      animate,
    });
    // viewKey resume tudo o que deve disparar o movimento da câmera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */
export default function MapView({
  mode = 'demo', phase, result, territories, layerState, layers, onToggleLayer, pointFilter, onTogglePointFilter,
  focusId, onFocus, selectedIds, layerInfo, nameOf = (u) => u.name, dark = false,
  priorityRecords = [], priorityAnalysis = null, priorityFocus = null, onPriorityFocus,
}) {
  const pal = MAP_PALETTE[dark ? 'dark' : 'light'];
  const [tileErrors, setTileErrors] = useState(0);
  const [tileLoaded, setTileLoaded] = useState(false);
  const isReal = mode === 'real';
  const isDemo = !isReal;
  const done = phase === 'done' && result;
  const layerLoaded = isReal && layerState?.status === 'loaded';

  // Janela de navegação: área demo, camada oficial carregada ou Brasil.
  const areaBounds = isDemo ? DEMO_BOUNDS : layerLoaded ? territories.bounds : BRAZIL_BOUNDS;
  const maxBounds = isDemo ? DEMO_MAX_BOUNDS : layerLoaded ? padBounds(territories.bounds, LAYER_BOUNDS_PADDING) : undefined;

  // Unidades com pontos associados, por id.
  const unitsById = useMemo(
    () => new Map((done ? result.units : []).map((u, i) => [u.id, { ...u, number: i + 1 }])),
    [done, result],
  );

  const visiblePoints = useMemo(() => (done ? pointsForMap(result, pointFilter) : []), [done, result, pointFilter]);

  const targetBounds = useMemo(() => {
    if (!done) return areaBounds;
    if (focusId && unitsById.has(focusId)) return padBounds(unitsById.get(focusId).bounds, 0.15);
    if (!result.units.length) return areaBounds;
    return padBounds(mergeBounds(result.units.map((u) => u.bounds)), 0.12);
  }, [done, focusId, unitsById, result, areaBounds]);

  // Pontos prioritários: cadastros ativos + situação na análise atual.
  const alertByRecord = useMemo(
    () => new Map((priorityAnalysis && !priorityAnalysis.blocked ? priorityAnalysis.alerts : []).map((a) => [a.recordId, a])),
    [priorityAnalysis],
  );
  const pointByKey = useMemo(() => new Map((done ? result.points : []).map((p) => [p.key, p])), [done, result]);
  const focusedRecord = priorityFocus ? priorityRecords.find((r) => r.id === priorityFocus.recordId) : null;
  const prioFocusKeys = useMemo(() => new Set(priorityFocus?.pointKeys ?? []), [priorityFocus]);
  const prioTarget = useMemo(() => {
    if (!focusedRecord) return null;
    const pts = [[focusedRecord.lat, focusedRecord.lng],
      ...[...prioFocusKeys].map((k) => pointByKey.get(k)).filter(Boolean).map((p) => [p.lat, p.lng])];
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const m = 0.0015;
    return [[Math.min(...lats) - m, Math.min(...lngs) - m], [Math.max(...lats) + m, Math.max(...lngs) + m]];
  }, [focusedRecord, prioFocusKeys, pointByKey]);

  const tilesUnavailable = tileErrors >= 4 && !tileLoaded;
  // Polígonos: no demo, só após o processamento; no real, assim que a camada carrega.
  const showTerritories = layers.territories && territories && (isDemo ? done : layerLoaded);

  const phaseBadge = {
    idle: <StatusBadge tone="neutral">Aguardando processamento</StatusBadge>,
    processing: <StatusBadge tone="progress" icon={LoaderCircle}>Processando</StatusBadge>,
    done: isDemo
      ? <StatusBadge tone="success" icon={CircleCheck}>Simulação concluída</StatusBadge>
      : <StatusBadge tone="success" icon={CircleCheck}>Cruzamento concluído</StatusBadge>,
    error: <StatusBadge tone="danger" icon={CircleAlert}>Erro no processamento</StatusBadge>,
  }[phase];

  const counts = done ? { matched: result.matched, unmatched: result.unmatched, ambiguous: result.ambiguous } : null;
  const showOverlay = isDemo ? phase !== 'done' : (!layerLoaded || phase === 'processing' || phase === 'error');

  return (
    <section className="flex min-h-[520px] flex-1 flex-col overflow-hidden 2xl:min-h-[360px] rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="map-title">
      <div className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-2">
        <h2 id="map-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-petrol-900">
          <MapPinned className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          Mapa do desligamento
        </h2>
        {phaseBadge}
        <span className="ml-auto truncate text-[12px] text-slate-500">
          {layerInfo.title}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapContainer
          bounds={areaBounds}
          maxBounds={maxBounds}
          maxBoundsViscosity={0.9}
          minZoom={isDemo ? 9 : layerLoaded ? 8 : 4}
          zoomSnap={0.25}
          zoomControl={false}
          preferCanvas={isReal}
          className="absolute inset-0 h-full w-full"
          aria-label="Mapa interativo dos pontos e unidades territoriais"
        >
          <TileLayer
            url={TILE_LAYER.url}
            attribution={TILE_LAYER.attribution}
            maxZoom={TILE_LAYER.maxZoom}
            eventHandlers={{
              tileerror: () => setTileErrors((n) => n + 1),
              tileload: () => setTileLoaded(true),
            }}
          />
          <ZoomControl position="bottomright" />
          <MapController
            viewKey={`${phase}|${focusId ?? ''}|${priorityFocus?.recordId ?? ''}|${priorityFocus?.nonce ?? ''}`}
            targetBounds={prioTarget ?? targetBounds}
            maxZoom={prioTarget ? 16 : 13}
          />

          {showTerritories && territories.features.map((feature) => {
            const { id } = feature.properties;
            const unit = unitsById.get(id);
            const affected = !!unit;
            const focused = focusId === id;
            const style = polygonStyle({
              affected,
              focused,
              dimmed: !!focusId && !focused,
              included: affected && selectedIds.includes(id),
              pal,
            });
            return (
              <Polygon
                key={id}
                positions={geometryToLatLngs(feature.geometry)}
                pathOptions={style}
                eventHandlers={affected ? { click: () => onFocus(id) } : undefined}
                interactive={affected || isReal}
              >
                {affected && (
                  <Tooltip permanent direction="center" className="cr-region-label" interactive={false}>
                    <span className={`cr-region-chip ${focused ? 'is-focused' : ''}`}>
                      <b>{String(unit.number).padStart(2, '0')}</b>
                      {/* Sem nome, só o número da lista; o código oficial aparece na lista. */}
                      {nameOf(unit)}
                    </span>
                  </Tooltip>
                )}
                {!affected && isReal && (
                  <Tooltip sticky className="cr-point-tip">
                    {layerInfo.unitType} {feature.properties.code}
                    {feature.properties.name && <><br />{feature.properties.name}</>}
                    <br />
                    {done ? 'Sem pontos associados' : 'Camada oficial'}
                  </Tooltip>
                )}
              </Polygon>
            );
          })}

          {done && layers.points && visiblePoints.map((p) => {
            const related = p.unitId === focusId || p.candidates?.includes(focusId);
            const inFocus = !focusId || related;
            const unit = p.unitId ? unitsById.get(p.unitId) : null;
            const style = pointStyle({
              focused: !!focusId && inFocus, dimmed: !inFocus, status: p.status, pal,
            });
            // Pontos do CSV envolvidos no alerta selecionado.
            const prioHit = prioFocusKeys.has(p.key);
            return (
              <CircleMarker
                key={p.key}
                center={[p.lat, p.lng]}
                pathOptions={prioHit ? {
                  ...style, radius: 7, color: '#EE7A12', weight: 3, opacity: 1, fillOpacity: 1,
                } : style}
              >
                <Tooltip direction="top" offset={[0, -4]} className="cr-point-tip">
                  {isDemo ? (
                    <>
                      <strong>{p.id}</strong> | {p.property}
                      <br />
                      {unit ? unit.label : 'Sem correspondência'}
                    </>
                  ) : (
                    <>
                      <strong>{p.id ?? `Linha ${p.line}`}</strong>{p.id && ` | linha ${p.line}`}
                      <br />
                      {unit ? `${layerInfo.unitType} ${unit.code}` : STATUS_TEXT[p.status]}
                      {p.status === 'ambiguous' && <><br />Candidatas: {p.candidates.join(', ')}</>}
                    </>
                  )}
                </Tooltip>
              </CircleMarker>
            );
          })}
          {layers.priority && focusedRecord && [...prioFocusKeys].map((k) => pointByKey.get(k)).filter(Boolean).map((p) => (
            <Polyline
              key={`l-${p.key}`}
              positions={[[focusedRecord.lat, focusedRecord.lng], [p.lat, p.lng]]}
              pathOptions={{ color: '#EE7A12', weight: 2, dashArray: '4 4' }}
              interactive={false}
            />
          ))}

          {layers.priority && priorityRecords.map((r) => {
            const a = alertByRecord.get(r.id);
            const focused = priorityFocus?.recordId === r.id;
            return (
              <Marker
                key={`pp-${r.id}`}
                position={[r.lat, r.lng]}
                icon={priorityIcon({ category: r.category, status: a?.matchStatus, focused })}
                zIndexOffset={focused ? 1000 : a ? 500 : 0}
                keyboard={false}
                eventHandlers={onPriorityFocus ? { click: () => onPriorityFocus(r.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -12]} className="cr-point-tip">
                  <strong>{r.id}</strong> | {PRIORITY_CATEGORIES[r.category]?.label}
                  <br />
                  {a
                    ? `${MATCH_LABEL[a.matchStatus]}: ${a.distanceMeters.toLocaleString('pt-BR')} m de ${a.primaryPointLabel}`
                    : (done ? 'Sem alerta nesta análise' : 'Ponto prioritário cadastrado')}
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Controles flutuantes (telas médias e grandes) */}
        <div className="pointer-events-none absolute left-3 top-3 z-[500] hidden md:block">
          <div className="pointer-events-auto">
            <LayerControl
              layers={layers}
              onToggle={onToggleLayer}
              territorialTitle={isDemo ? 'Demonstrativa' : `${layerInfo.unitType} — IBGE ${layerInfo.referenceYear}`}
              pointFilter={isReal ? pointFilter : null}
              onTogglePointFilter={onTogglePointFilter}
              counts={counts}
              priorityCount={priorityRecords.length}
            />
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] hidden md:block">
          <div className="pointer-events-auto"><MapLegend demo={isDemo} layerInfo={layerInfo} showPriority={layers.priority && priorityRecords.length > 0} /></div>
        </div>

        <div className="pointer-events-none absolute left-3 right-3 top-3 z-[500] flex justify-end md:left-auto md:max-w-[calc(100%-260px)]">
          {isDemo ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-sm">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              Dados demonstrativos — geometrias territoriais ilustrativas
            </span>
          ) : layerLoaded && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-petrol-200 bg-white/95 px-3 py-1.5 text-[12px] font-medium text-petrol-800 shadow-sm">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              {layerInfo.statusLabel}{done ? ' | pontos do CSV (processamento local)' : ''}
            </span>
          )}
        </div>

        {tilesUnavailable && (
          <div className="absolute bottom-3 left-1/2 z-[500] -translate-x-1/2" role="alert">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-[12px] text-red-700 shadow-sm">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Fundo cartográfico indisponível. As camadas e os resultados continuam funcionando.
            </span>
          </div>
        )}

        {/* Estados sem resultado */}
        {showOverlay && (
          <div className="pointer-events-none absolute inset-0 z-[450] grid place-items-center bg-white/25">
            <div className="max-w-[360px] rounded-md border border-slate-200 bg-white/95 px-5 py-4 text-center shadow-lg" role="status" aria-live="polite">
              {isReal && phase !== 'processing' && phase !== 'error' && !layerLoaded && (
                <RealLayerStatus layerState={layerState} />
              )}
              {isDemo && phase === 'idle' && (
                <>
                  <MapPinned className="mx-auto h-6 w-6 text-petrol-400" aria-hidden="true" />
                  <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Aguardando processamento</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-slate-600">
                    Os pontos e as unidades territoriais aparecem aqui depois que as coordenadas forem processadas.
                  </p>
                </>
              )}
              {phase === 'processing' && (
                <>
                  <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-accent-500" aria-hidden="true" />
                  <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Validando pontos e cruzando dados geográficos</p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {isDemo ? 'Simulação local, sem consulta a serviços externos.' : 'Cruzamento real no navegador, sem envio de coordenadas.'}
                  </p>
                </>
              )}
              {phase === 'error' && (
                <>
                  <CircleAlert className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
                  <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Não foi possível concluir o processamento</p>
                  <p className="mt-1 text-[12.5px] text-slate-600">Confira a mensagem no painel de importação e tente novamente.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Em telas pequenas, camadas e legenda ficam abaixo do mapa */}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 p-2 md:hidden">
        <LayerControl
          layers={layers}
          onToggle={onToggleLayer}
          territorialTitle={isDemo ? 'Demonstrativa' : `${layerInfo.unitType} — IBGE ${layerInfo.referenceYear}`}
          pointFilter={isReal ? pointFilter : null}
          onTogglePointFilter={onTogglePointFilter}
          counts={counts}
              priorityCount={priorityRecords.length}
        />
        <MapLegend demo={isDemo} layerInfo={layerInfo} showPriority={layers.priority && priorityRecords.length > 0} />
      </div>
    </section>
  );
}

function RealLayerStatus({ layerState }) {
  if (layerState?.status === 'loading' || layerState?.status === 'idle') {
    return (
      <>
        <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-accent-500" aria-hidden="true" />
        <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Carregando camada territorial oficial…</p>
      </>
    );
  }
  if (layerState?.status === 'error') {
    return (
      <>
        <CircleAlert className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
        <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Camada oficial indisponível</p>
        <ul className="mt-1 text-left text-[12px] leading-snug text-slate-600">
          {layerState.errors.slice(0, 3).map((e) => <li key={e}>• {e}</li>)}
        </ul>
      </>
    );
  }
  return (
    <>
      <Database className="mx-auto h-6 w-6 text-petrol-400" aria-hidden="true" />
      <p className="mt-2 text-[13.5px] font-semibold text-petrol-900">Camada oficial não configurada</p>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-600">
        O município piloto ainda não foi definido. Prepare o recorte da malha do IBGE conforme
        docs/CAMADA_TERRITORIAL.md e atualize PILOT_CONFIG em src/config.js. Nenhuma geometria demonstrativa é exibida neste modo.
      </p>
    </>
  );
}
