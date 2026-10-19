import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
  MapContainer, TileLayer, Pane, Polygon, CircleMarker, Marker, Polyline, Tooltip, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import {
  LoaderCircle, MapPinned, CircleAlert, TriangleAlert, FlaskConical, CircleCheck, Database, Layers, X, ChevronRight, Maximize2, Minimize2,
} from 'lucide-react';
import LayerControl from './LayerControl.jsx';
import MapLayersDock, { LAYERS_PANEL_ID, MapChromeContext, desktopPadding } from './map/MapLayersDock.jsx';
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

/** Folga da câmera: no desktop, espaço para o painel de camadas; no celular, para os botões e o cartão. */
const CAMERA_PADDING = {
  compact: { paddingTopLeft: [20, 64], paddingBottomRight: [20, 96] },
  // Celular em paisagem (mapa baixo): folga mínima para a região caber.
  short: { paddingTopLeft: [16, 16], paddingBottomRight: [16, 16] },
};
const cameraPadding = (map, compact, dockOpen) => {
  if (!compact) return desktopPadding(dockOpen);
  return map.getSize().y < 420 ? CAMERA_PADDING.short : CAMERA_PADDING.compact;
};

/**
 * Controla a câmera do mapa a partir do estado da interface.
 * - Reajusta o tamanho do mapa quando o contêiner muda (layout responsivo).
 * - Voa até a área de interesse quando a fase ou a região em foco mudam.
 * - Celular: quando a tela Mapa volta a aparecer, chama map.invalidateSize().
 *   (Oculto, o mapa continua com o tamanho real; ver App.jsx.)
 * A câmera é limitada por maxBounds no MapContainer.
 */
function MapController({
  viewKey, targetBounds, maxZoom = 13, visible = true, compact = false, dockOpen = false,
}) {
  const map = useMap();
  const wasVisible = useRef(visible);

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!targetBounds) return;
    const animate = !prefersReducedMotion();
    map.flyToBounds(targetBounds, {
      ...cameraPadding(map, compact, dockOpen),
      maxZoom,
      duration: animate ? 0.7 : 0,
      animate,
    });
    // viewKey resume tudo o que deve disparar o movimento da câmera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useEffect(() => {
    const appeared = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (appeared) map.invalidateSize();
  }, [visible, map]);

  return null;
}

/**
 * Entrar e sair da tela cheia muda o tamanho do mapa. O ResizeObserver do
 * MapController reajusta o Leaflet, mas o recentramento arredonda pixels:
 * aqui a vista (centro e zoom) do momento da troca é restaurada exatamente.
 */
function KeepViewOnResize({ trigger }) {
  const map = useMap();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    // Roda antes do navegador aplicar o novo tamanho: a vista ainda é a anterior.
    const center = map.getCenter();
    const zoom = map.getZoom();
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        map.setView(center, zoom, { animate: false });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [map, trigger]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */
export default function MapView({
  mode = 'demo', phase, result, territories, layerState, layers, onToggleLayer, pointFilter, onTogglePointFilter,
  focusId, onFocus, selectedIds, layerInfo, nameOf = (u) => u.name, dark = false,
  priorityRecords = [], priorityAnalysis = null, priorityFocus = null, onPriorityFocus,
  visible = true, compact = false, onOpenDetails, className = '',
  // Modo real: sistema de camadas e sub-regiões (ver lib/useMapWorkspace.jsx).
  basemap = null, opPanes = null, opOpacity = null, mapChildren = null, layerPanel = null, overlay = null, headerActions = null, mobileActions = null, editing = false, sectorTooltips = true,
}) {
  const fade = (st, key) => {
    const k = opOpacity?.[key] ?? 1;
    return k === 1 ? st : { ...st, opacity: (st.opacity ?? 1) * k, fillOpacity: (st.fillOpacity ?? 0.2) * k };
  };
  // Pane de cada camada operacional (só no modo real; sem pane, o Leaflet usa o padrão).
  const paneOf = (key) => (opPanes ? { pane: opPanes[key] } : {});
  const tiles = basemap ?? { url: TILE_LAYER.url, attribution: TILE_LAYER.attribution, maxZoom: TILE_LAYER.maxZoom, className: 'cr-basemap-muted' };
  const pal = MAP_PALETTE[dark ? 'dark' : 'light'];
  // Painel "Camadas e legenda": aberto de início só em telas 2xl.
  const [dockOpen, setDockOpen] = useState(() => !!window.matchMedia?.('(min-width: 1536px)').matches);
  // Tela cheia por CSS (não a Fullscreen API: ela esconderia toasts e diálogos, que ficam fora do mapa).
  const [fullscreen, setFullscreen] = useState(false);
  const fsButtonRef = useRef(null);
  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // O primeiro Esc fecha só a tela cheia; o Esc do App (limpar foco) volta a valer depois.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return; // diálogo aberto trata o próprio Esc
      e.preventDefault();
      e.stopImmediatePropagation();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [fullscreen]);
  useEffect(() => {
    // Ao sair, o foco do teclado volta para o botão de tela cheia.
    if (wasFullscreen.current && !fullscreen) fsButtonRef.current?.focus();
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);
  const toggleFullscreen = () => {
    setFullscreen((v) => {
      if (!v) setDockOpen(true);
      return !v;
    });
  };
  const fsLabel = fullscreen ? 'Sair da tela cheia' : 'Abrir mapa em tela cheia';
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
    <section
      className={fullscreen
        ? 'cr-map-fullscreen fixed inset-0 z-[1000] flex flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]'
        : `isolate flex min-h-[520px] flex-1 flex-col overflow-hidden lg:h-[74vh] lg:max-h-[900px] lg:min-h-[560px] lg:flex-none rounded-md border border-slate-200 bg-white shadow-panel ${className}`}
      aria-labelledby="map-title"
    >
      <div className={`border-b border-slate-100 px-4 py-2 max-lg:px-3 ${fullscreen ? '' : 'max-lg:[@media(max-height:500px)]:hidden'}`}>
        {/* Uma linha no computador (título · situação · camada · ações); no celular a camada desce. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 max-lg:gap-x-2">
          <h2 id="map-title" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[17px] font-bold tracking-[-0.01em] text-petrol-900 max-lg:text-[15px]">
            <MapPinned className="h-4 w-4 text-petrol-500 max-lg:hidden" aria-hidden="true" />
            Mapa do desligamento
          </h2>
          {/* No celular o selo encolhe para o botão de tela cheia caber na mesma linha. */}
          <span className="flex min-w-0 max-lg:flex-1 max-lg:overflow-hidden">{phaseBadge}</span>
          {/* Situação da camada (antes flutuava sobre o mapa) */}
          <div className="order-last flex min-w-0 basis-full items-center gap-2 text-[13px] lg:order-none lg:flex-1 lg:basis-0">
            {isDemo ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900" title="Dados demonstrativos — geometrias territoriais ilustrativas">
                <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Dados demonstrativos — geometrias territoriais ilustrativas</span>
              </span>
            ) : layerLoaded && (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded border border-petrol-200 bg-petrol-50 px-2 py-0.5 font-medium text-petrol-800" title={`${layerInfo.statusLabel}${done ? ' · pontos do CSV (processamento local)' : ''}`}>
                <Database className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{layerInfo.statusLabel}{done ? ' · pontos do CSV (processamento local)' : ''}</span>
              </span>
            )}
            <span className="min-w-0 truncate text-slate-500 max-sm:hidden lg:max-2xl:hidden">{layerInfo.title}</span>
          </div>
          {headerActions && <span className="shrink-0 max-lg:hidden">{headerActions}</span>}
          <button
            ref={fsButtonRef}
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            aria-label={fsLabel}
            title={fsLabel}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-petrol-700 hover:bg-slate-50 max-lg:h-11 max-lg:w-11"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
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
            key={tiles.url}
            url={tiles.url}
            attribution={tiles.attribution}
            maxZoom={tiles.maxZoom}
            maxNativeZoom={tiles.maxNativeZoom}
            className={tiles.className}
            eventHandlers={{
              tileerror: () => setTileErrors((n) => n + 1),
              tileload: () => setTileLoaded(true),
            }}
          />
          {tiles.labels && (
            // Nomes do mapa base acima das camadas (só a partir do zoom indicado, para o mapa ficar limpo de longe).
            <Pane name="cr-basemap-labels" style={{ zIndex: 595, pointerEvents: 'none' }}>
              <TileLayer
                key={tiles.labels.url}
                url={tiles.labels.url}
                minZoom={tiles.labels.minZoom}
                maxZoom={tiles.maxZoom}
                maxNativeZoom={tiles.maxNativeZoom}
                className={tiles.className}
              />
            </Pane>
          )}
          <ZoomControl position={compact ? 'bottomright' : 'topleft'} />
          <MapController
            viewKey={`${phase}|${focusId ?? ''}|${priorityFocus?.recordId ?? ''}|${priorityFocus?.nonce ?? ''}`}
            targetBounds={prioTarget ?? targetBounds}
            maxZoom={prioTarget ? 16 : 13}
            visible={visible}
            compact={compact}
            dockOpen={dockOpen && !compact}
          />
          <KeepViewOnResize trigger={fullscreen} />
          {/* Panes, camadas da organização, editor e cliques (modo real); antes das operacionais, que usam os panes. */}
          <MapChromeContext.Provider value={{ dockOpen: dockOpen && !compact, compact }}>{mapChildren}</MapChromeContext.Provider>

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
                pathOptions={fade(style, 'territories')}
                eventHandlers={affected && !editing ? { click: () => onFocus(id) } : undefined}
                interactive={(affected || isReal) && !editing}
                // Clique numa região afetada foca a região e não abre o cartão de seleção do mapa.
                bubblingMouseEvents={!affected}
                pmIgnore
                {...paneOf('territories')}
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
                {!affected && isReal && sectorTooltips && (
                  <Tooltip sticky className="cr-point-tip">
                    <span className="cr-tip-title">{feature.properties.name || `${layerInfo.unitType} ${feature.properties.code}`}</span>
                    <span className="cr-tip-sub">{layerInfo.unitType} {feature.properties.code}</span>
                    <span className="cr-tip-sub">{done ? 'Sem pontos associados' : 'Camada oficial'}</span>
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
                bubblingMouseEvents={false}
                pmIgnore
                {...paneOf('points')}
                pathOptions={fade(prioHit ? {
                  ...style, radius: 7, color: '#EE7A12', weight: 3, opacity: 1, fillOpacity: 1,
                } : style, 'points')}
              >
                <Tooltip direction="top" offset={[0, -4]} className="cr-point-tip">
                  {isDemo ? (
                    <>
                      <span className="cr-tip-title">{p.id}</span>
                      <span className="cr-tip-sub">{p.property}</span>
                      <span className={`cr-tip-status${unit ? '' : ' is-low'}`}>{unit ? unit.label : 'Sem correspondência'}</span>
                    </>
                  ) : (
                    <>
                      <span className="cr-tip-title">{p.id ?? `Linha ${p.line}`}</span>
                      {p.place?.rotulo && <span className="cr-tip-sub">{p.place.local ?? p.place.rotulo}</span>}
                      <dl className="cr-tip-meta">
                        {p.id && <><dt>Linha do CSV</dt><dd>{p.line}</dd></>}
                        <dt>{unit ? layerInfo.unitType : 'Situação'}</dt>
                        <dd>{unit ? p.sectorCode ?? unit.code : STATUS_TEXT[p.status]}</dd>
                        {p.status === 'ambiguous' && <><dt>Candidatas</dt><dd>{p.candidates.join(', ')}</dd></>}
                        {p.place?.municipio && <><dt>Município</dt><dd>{p.place.municipio.nome}{p.place.municipio.uf ? `/${p.place.municipio.uf}` : ''}</dd></>}
                      </dl>
                      {p.place?.comunidade?.aproximada && <span className="cr-tip-status is-low">Localização aproximada</span>}
                      {p.place?.origem_nome === 'comunidade_proxima' && <span className="cr-tip-note">Comunidade mais próxima do ponto</span>}
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
              pmIgnore
              {...paneOf('priority')}
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
                pmIgnore
                {...paneOf('priority')}
                eventHandlers={onPriorityFocus ? { click: () => onPriorityFocus(r.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -12]} className="cr-point-tip">
                  <span className="cr-tip-title">{r.id}</span>
                  <span className="cr-tip-sub">{PRIORITY_CATEGORIES[r.category]?.label}</span>
                  {a ? (
                    <dl className="cr-tip-meta">
                      <dt>Situação</dt><dd>{MATCH_LABEL[a.matchStatus]}</dd>
                      <dt>Distância</dt><dd>{a.distanceMeters.toLocaleString('pt-BR')} m</dd>
                      <dt>Ponto</dt><dd>{a.primaryPointLabel}</dd>
                    </dl>
                  ) : <span className="cr-tip-sub">{done ? 'Sem alerta nesta análise' : 'Ponto prioritário cadastrado'}</span>}
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Camadas e legenda: um só painel (canto superior direito; no celular, folha de baixo para cima) */}
        <MapLayersDock open={dockOpen} onOpenChange={setDockOpen} sheet={compact} hidden={editing}>
          {layerPanel ?? (
            <LayerControl
              layers={layers}
              onToggle={onToggleLayer}
              territorialTitle={isDemo ? 'Demonstrativa' : `${layerInfo.unitType} — IBGE ${layerInfo.referenceYear}`}
              pointFilter={isReal ? pointFilter : null}
              onTogglePointFilter={onTogglePointFilter}
              counts={counts}
              priorityCount={priorityRecords.length}
              demo={isDemo}
            />
          )}
        </MapLayersDock>

        {/* Celular/tablet: botão do painel e atalhos do mapa */}
        {compact && !editing && (
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-[600] flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => setDockOpen((v) => !v)}
              aria-expanded={dockOpen}
              aria-controls={LAYERS_PANEL_ID}
              className={`pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-[15px] font-medium shadow-md ${
                dockOpen ? 'border-petrol-700 bg-petrol-700 text-white' : 'border-slate-200 bg-white text-petrol-800'
              }`}
            >
              <Layers className="h-4 w-4" aria-hidden="true" />
              Camadas e legenda
            </button>
            {mobileActions && <div className="pointer-events-auto contents">{mobileActions}</div>}
          </div>
        )}

        {/* Celular: região em foco, com atalho para os detalhes */}
        {overlay}

        {compact && !editing && focusId && unitsById.has(focusId) && (() => {
          const unit = unitsById.get(focusId);
          return (
            <div className="absolute bottom-3 left-3 right-[4.25rem] z-[600] flex items-center gap-2 rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-1 shadow-lg lg:hidden">
              <span className="grid h-8 w-9 shrink-0 place-items-center rounded bg-petrol-800 text-[15px] font-semibold text-white">
                {String(unit.number).padStart(2, '0')}
              </span>
              <button type="button" onClick={() => onOpenDetails?.(focusId)} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-petrol-900">{nameOf(unit) ?? `Região ${String(unit.number).padStart(2, '0')}`}</span>
                  <span className="block text-[14px] text-slate-500">{unit.count} pontos · Ver detalhes</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onFocus(focusId)} aria-label="Limpar foco da região" className="grid h-11 w-11 shrink-0 place-items-center rounded text-slate-500">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          );
        })()}

        {tilesUnavailable && (
          <div className="absolute bottom-3 left-1/2 z-[500] -translate-x-1/2" role="alert">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-[13px] text-red-700 shadow-sm">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Fundo cartográfico indisponível. As camadas e os resultados continuam funcionando.
            </span>
          </div>
        )}

        {/* Estados sem resultado */}
        {showOverlay && (
          <div className="pointer-events-none absolute inset-0 z-[450] grid place-items-center bg-white/25">
            <div className="max-w-[360px] rounded-md border border-slate-200 bg-white/95 px-5 py-4 text-center shadow-lg max-lg:mx-4" role="status" aria-live="polite">
              {isReal && phase !== 'processing' && phase !== 'error' && !layerLoaded && (
                <RealLayerStatus layerState={layerState} />
              )}
              {isDemo && phase === 'idle' && (
                <>
                  <MapPinned className="mx-auto h-6 w-6 text-petrol-400" aria-hidden="true" />
                  <p className="mt-2 text-[15px] font-semibold text-petrol-900">Aguardando processamento</p>
                  <p className="mt-1 text-[14px] leading-snug text-slate-600">
                    Os pontos e as unidades territoriais aparecem aqui depois que as coordenadas forem processadas.
                  </p>
                </>
              )}
              {phase === 'processing' && (
                <>
                  <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-accent-500" aria-hidden="true" />
                  <p className="mt-2 text-[15px] font-semibold text-petrol-900">Validando pontos e cruzando dados geográficos</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {isDemo ? 'Simulação local, sem consulta a serviços externos.' : 'Cruzamento real no navegador, sem envio de coordenadas.'}
                  </p>
                </>
              )}
              {phase === 'error' && (
                <>
                  <CircleAlert className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
                  <p className="mt-2 text-[15px] font-semibold text-petrol-900">Não foi possível concluir o processamento</p>
                  <p className="mt-1 text-[14px] text-slate-600">Confira a mensagem no painel de importação e tente novamente.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

    </section>
  );
}

function RealLayerStatus({ layerState }) {
  if (layerState?.status === 'loading' || layerState?.status === 'idle') {
    return (
      <>
        <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-accent-500" aria-hidden="true" />
        <p className="mt-2 text-[15px] font-semibold text-petrol-900">Carregando camada territorial oficial…</p>
      </>
    );
  }
  if (layerState?.status === 'error') {
    return (
      <>
        <CircleAlert className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
        <p className="mt-2 text-[15px] font-semibold text-petrol-900">Camada oficial indisponível</p>
        <ul className="mt-1 text-left text-[13px] leading-snug text-slate-600">
          {layerState.errors.slice(0, 3).map((e) => <li key={e}>• {e}</li>)}
        </ul>
      </>
    );
  }
  return (
    <>
      <Database className="mx-auto h-6 w-6 text-petrol-400" aria-hidden="true" />
      <p className="mt-2 text-[15px] font-semibold text-petrol-900">Camada oficial não configurada</p>
      <p className="mt-1 text-[14px] leading-snug text-slate-600">
        O município piloto ainda não foi definido. Prepare o recorte da malha do IBGE conforme
        docs/CAMADA_TERRITORIAL.md e atualize PILOT_CONFIG em src/config.js. Nenhuma geometria demonstrativa é exibida neste modo.
      </p>
    </>
  );
}
