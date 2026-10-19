import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { TriangleAlert } from 'lucide-react';
import Header, { ModeSwitch } from './components/Header.jsx';
import MobileNav from './components/MobileNav.jsx';
import CsvUpload from './components/CsvUpload.jsx';
import RealImportPanel from './components/RealImportPanel.jsx';
import OutageInfo from './components/OutageInfo.jsx';
import OutageForm from './components/OutageForm.jsx';
import Timeline from './components/Timeline.jsx';
import KpiCards, { KpiStrip } from './components/KpiCards.jsx';
import MapView from './components/MapView.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import CommunicationPanel from './components/CommunicationPanel.jsx';
import AuditDialog from './components/AuditDialog.jsx';
import Toasts from './components/Toasts.jsx';
import PriorityAlertsPanel from './components/PriorityAlertsPanel.jsx';
import PriorityRegistry from './components/PriorityRegistry.jsx';
import { buildDemoPriorityRecords } from './data/demoPriority.js';
import {
  OUTAGE, DEMO_FILE_NAME, DEMO_POINTS, DEMO_TERRITORIES,
} from './data/mockData.js';
import {
  TERRITORIAL_LAYER, PROCESSING_STEPS, PROCESSING_DURATION_MS, PILOT_CONFIG, PILOT_STATUS_LABEL, ANNOUNCEMENT_RULES, PRIORITY_MATCH,
} from './config.js';
import { mockSpatialJoin } from './lib/mockSpatialJoin.js';
import { placeJoin } from './lib/placeJoin.js';
import { readPointsFile } from './lib/spreadsheet.js';
import { loadFarmIndex } from './lib/farmIndex.js';
import { withManualPoints, isManualLine, MANUAL_FILE_NAME } from './lib/manualPoints.js';
import { loadLayer, loadNameCorrespondence } from './lib/layer.js';
import {
  buildTraditionalNotice, buildTraditionalFromNames, buildRadioLetterFromLines, hasPlaceholders, resolveSpeakableName,
} from './lib/communicationUtils.js';
import { buildAnnouncement } from './lib/announcement.js';
import {
  renameRegion, removeRegionName, storeToCorrespondence, exportStore, importStore,
  loadStore, saveStore, loadOperator, saveOperator,
} from './lib/regionNames.js';
import {
  parseCsv, validateCoordinates, readFileAsText, suggestMapping, validateRecords, isProcessableCrs, hasFarmMapping,
} from './lib/csv.js';
import { buildOutageView, EMPTY_OUTAGE_FORM } from './lib/outage.js';
import {
  summarize, DEFAULT_POINT_FILTER, attachPlaces, communitiesByUnit,
} from './lib/summary.js';
import { groupByPlace } from './lib/placeRegions.js';
import { placeSnapshot, placeChanged } from './lib/placeNames.js';
import { isValidCoordinate } from './lib/priorityRecords.js';
import { useTheme } from './lib/theme.js';
import { useAccessIdentity } from './lib/useAccessIdentity.js';
import { usePriorityRegistry } from './lib/usePriorityRegistry.js';
import { priorityScope } from './lib/priorityRepository.js';
import { upsertRecord, setRecordStatus, deleteRecord } from './lib/priorityRecords.js';
import { matchPriorityPoints } from './lib/priorityMatch.js';
import {
  buildAnalysisRef, syncAlerts, transitionAlert, alertGate, alertKey,
} from './lib/priorityAlerts.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { useMapWorkspace } from './lib/useMapWorkspace.jsx';
import { PointFilters } from './components/LayerControl.jsx';

const DEMO_FILE = {
  source: 'demo',
  name: DEMO_FILE_NAME,
  records: DEMO_POINTS.length,
  status: 'queued',
  validation: null,
};
const EMPTY_NOTICE = { text: '', status: 'draft', dirty: false, stale: false };
const DEFAULT_LAYERS = { points: true, territories: true, priority: true };
const EMPTY_IMPORT = {
  status: 'empty',
  fileName: '',
  encoding: '',
  format: '', // csv | xlsx
  sheets: null, // abas do Excel ({ name, table }) — só em memória
  sheetIndex: 0,
  parsed: null,
  mapping: {},
  // Mapeamento usado na última validação (inclui as colunas dos pontos inseridos à mão).
  effectiveMapping: null,
  crs: '',
  validation: null,
  error: '',
  // Pontos inseridos à mão (lat/long ou CAR), validados junto com o arquivo.
  manual: [],
};
const parsedFromTable = (table) => ({ ...table, rowCount: table.rows.length, preview: table.rows.slice(0, 5) });

/**
 * Referencial efetivo: o declarado pelo operador; sem declaração, SIRGAS 2000
 * quando todos os pontos válidos vêm do catálogo de fazendas ou foram
 * digitados em graus decimais (não dependem do referencial do arquivo).
 */
function needsDeclaredCrs(validation) {
  return (validation?.records ?? []).some((r) => r.status === 'valid' && r.coordOrigin === 'arquivo' && !r.manual);
}
const effectiveCrs = (imp) => (isProcessableCrs(imp.crs) || needsDeclaredCrs(imp.validation) ? imp.crs : 'EPSG:4674');

/** Metadados exibidos da camada no modo real. */
const REAL_LAYER_INFO = {
  mode: PILOT_CONFIG.status === 'not-configured' ? 'not-configured' : 'official',
  title: PILOT_CONFIG.layer.title,
  unitType: PILOT_CONFIG.layer.unitType,
  source: `${PILOT_CONFIG.layer.source}${PILOT_CONFIG.layer.obtainedOn ? ` (obtida em ${PILOT_CONFIG.layer.obtainedOn})` : ''}`,
  code: PILOT_CONFIG.layer.fields.idField,
  referenceYear: PILOT_CONFIG.layer.referenceYear,
  statusLabel: PILOT_STATUS_LABEL[PILOT_CONFIG.status],
  territory: PILOT_CONFIG.territory,
  note: PILOT_CONFIG.status === 'not-configured'
    ? 'Município piloto ainda não definido. O cruzamento real fica bloqueado até a camada ser preparada (docs/CAMADA_TERRITORIAL.md).'
    : `${PILOT_STATUS_LABEL[PILOT_CONFIG.status]} — ${[PILOT_CONFIG.territory.name, PILOT_CONFIG.territory.uf].filter(Boolean).join('/')}`,
};

export default function App() {
  /* ---------------- Estado central ---------------- */
  const [mode, setMode] = useState('demo'); // demo | real
  const { preference: themePreference, theme, setPreference: setThemePreference } = useTheme();
  const [file, setFile] = useState(DEMO_FILE);
  const [phase, setPhase] = useState('idle'); // idle | processing | done | error
  const [stepIndex, setStepIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  // Cruzamento bruto (por setor censitário). A lista de regiões usa `result`, derivado abaixo.
  const [joinResult, setResult] = useState(null);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [pointFilter, setPointFilter] = useState(DEFAULT_POINT_FILTER);
  const [focusId, setFocusId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [notice, setNotice] = useState(EMPTY_NOTICE);
  const [toasts, setToasts] = useState([]);
  const [auditOpen, setAuditOpen] = useState(false);
  // Forma de citação escolhida pelo operador por região ('region' | 'properties'); vale para este processamento.
  const [announceOverrides, setAnnounceOverrides] = useState({});

  // Somente modo real (mantidos em memória; nunca em localStorage).
  const [imp, setImp] = useState(EMPTY_IMPORT);
  const impMapping = imp.effectiveMapping ?? imp.mapping;
  const [outageForm, setOutageForm] = useState(EMPTY_OUTAGE_FORM);
  const [layerState, setLayerState] = useState({ status: 'idle', layer: null, errors: [], warnings: [], correspondence: {} });
  // Nomes de região definidos pelo operador (salvos neste navegador, com histórico).
  const [regionStore, setRegionStore] = useState(() => loadStore(PILOT_CONFIG.territory.ibgeCode));
  const [typedOperator, setTypedOperator] = useState(() => loadOperator());
  // Com o Cloudflare Access, o responsável é o e-mail autenticado (somente
  // leitura, só em memória). Sem Access (ex.: npm run dev), vale o nome digitado.
  const identity = useAccessIdentity();
  const operator = identity?.email ?? typedOperator;
  const operatorLocked = !!identity;
  const authorFor = (by) => identity?.email ?? by;
  const rememberOperator = (by) => {
    if (identity) return; // o e-mail nunca vai para o localStorage como "último responsável"
    setTypedOperator(by.trim());
    saveOperator(by);
  };

  // Pontos prioritários: cadastro e histórico de alertas persistidos por escopo (demo / real).
  const priorityRegistry = usePriorityRegistry(priorityScope(mode, PILOT_CONFIG.territory.ibgeCode), {
    seed: mode === 'demo' ? buildDemoPriorityRecords : null,
    onError: (msg) => notify('error', msg),
  });
  const [priorityTolerance, setPriorityTolerance] = useState(PRIORITY_MATCH.toleranceMeters);
  const [analysisRef, setAnalysisRef] = useState(null); // desligamento analisado (congelado no processamento)
  const [priorityFocus, setPriorityFocus] = useState(null); // { recordId, pointKeys, nonce }
  const [registryNav, setRegistryNav] = useState(null); // null | { view: 'list' } | { view: 'form', editingId, prefill? }

  // Celular/tablet (abaixo de lg): uma tela por vez, escolhida na barra inferior.
  // Todas as telas continuam montadas; só a apresentação muda (nenhum estado se perde).
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState('dados'); // dados | regioes | mapa | aviso | alertas
  const [regionDetailId, setRegionDetailId] = useState(null); // detalhes da região em tela cheia
  const mainRef = useRef(null);
  const scrollByScreen = useRef({});
  const screenKey = mobileTab === 'regioes' && regionDetailId ? `regioes:${regionDetailId}` : mobileTab;
  const screenKeyRef = useRef(screenKey);
  screenKeyRef.current = screenKey;
  // Cada tela guarda a própria posição de rolagem.
  useLayoutEffect(() => {
    if (mainRef.current && isMobile) mainRef.current.scrollTop = scrollByScreen.current[screenKey] ?? 0;
  }, [screenKey, isMobile]);

  const isReal = mode === 'real';
  const timers = useRef([]);
  const addPointRef = useRef(null);
  const toastSeq = useRef(0);

  /* ---------------- Notificações ---------------- */
  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const notify = useCallback((type, message) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((list) => [...list.slice(-3), { id, type, message }]);
    setTimeout(() => dismissToast(id), 4000);
  }, [dismissToast]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const priorityRecordsActive = useMemo(
    () => priorityRegistry.records.filter((r) => r.status === 'active' && Number.isFinite(r.lat) && Number.isFinite(r.lng)),
    [priorityRegistry.records],
  );

  /* ---------------- Camadas e sub-regiões (somente modo real) ---------------- */
  const done = phase === 'done' && joinResult;
  const ws = useMapWorkspace({
    enabled: isReal,
    identity,
    operator,
    operatorLocked,
    authorFor,
    rememberOperator,
    notify,
    opLayers: layers,
    setOpLayers: setLayers,
    pointFilterExtra: isReal && done ? (
      <PointFilters
        pointFilter={pointFilter}
        onTogglePointFilter={(key) => setPointFilter((f) => ({ ...f, [key]: !f[key] }))}
        counts={{ matched: joinResult.matched, unmatched: joinResult.unmatched, ambiguous: joinResult.ambiguous }}
      />
    ) : null,
    result: done ? joinResult : null,
    priorityRecords: priorityRecordsActive,
    sectorLayer: layerState.layer,
    isMobile,
    onShowMap: () => setMobileTab('mapa'),
    // Coordenada buscada no mapa: incluir no desligamento ou cadastrar como ponto prioritário.
    onAddPoint: isReal ? (p) => addPointRef.current?.(p) : null,
    onRegisterPriority: (p) => setRegistryNav({ view: 'form', editingId: null, prefill: { lat: p.lat, lng: p.lng, nonce: Date.now() } }),
  });


  /* ---------------- Localização dos pontos e regiões por microrregião ---------------- */
  // Modo real: cada ponto recebe o lugar (IBGE + comunidades) e a lista de regiões passa a
  // ter uma região por microrregião (lib/placeRegions.js). Cache por resultado e localizador:
  // o mesmo processamento não é relocalizado a cada renderização.
  const placeCache = useRef({ locator: null, layer: null, map: new WeakMap() });
  const placesFor = useCallback((joined) => {
    const locator = isReal ? ws.locator : null;
    if (!joined || !locator || joined.source === 'demo') return { placed: joined, communities: new Map() };
    const sectorLayer = layerState.layer;
    if (placeCache.current.locator !== locator || placeCache.current.layer !== sectorLayer) {
      placeCache.current = { locator, layer: sectorLayer, map: new WeakMap() };
    }
    let hit = placeCache.current.map.get(joined);
    if (!hit) {
      const placed = groupByPlace(attachPlaces(joined, locator), { locator, sectorLayer });
      hit = { placed, communities: communitiesByUnit(placed) };
      placeCache.current.map.set(joined, hit);
      placeCache.current.map.set(placed, hit);
    }
    return hit;
  }, [isReal, ws.locator, layerState.layer]);
  const placed = useMemo(() => placesFor(joinResult), [placesFor, joinResult]);
  const result = placed.placed;

  // Quando as regiões mudam depois do processamento (comunidades importadas ou editadas),
  // a seleção acompanha: regiões novas entram no aviso; as retiradas pelo operador continuam fora.
  const unitIdsKey = result?.units.map((u) => u.id).join('|') ?? '';
  const prevUnits = useRef({ key: '', ids: [] });
  useEffect(() => {
    const prev = prevUnits.current;
    const ids = unitIdsKey ? unitIdsKey.split('|') : [];
    prevUnits.current = { key: unitIdsKey, ids };
    if (phase !== 'done' || !prev.key || prev.key === unitIdsKey) return;
    const known = new Set(prev.ids);
    setSelectedIds((sel) => ids.filter((id) => sel.includes(id) || !known.has(id)));
    setFocusId((f) => (f && ids.includes(f) ? f : null));
    setRegionDetailId((d) => (d && ids.includes(d) ? d : null));
  }, [unitIdsKey, phase]);

  /* ---------------- Camada oficial (modo real) ---------------- */
  // A camada (dado público) é carregada uma vez e mantida entre trocas de modo.
  const layerSettled = useRef(false);
  useEffect(() => {
    if (!isReal || layerSettled.current) return undefined;
    if (PILOT_CONFIG.status === 'not-configured') {
      layerSettled.current = true;
      setLayerState((s) => ({ ...s, status: 'not-configured' }));
      return undefined;
    }
    const controller = new AbortController();
    setLayerState((s) => ({ ...s, status: 'loading' }));
    Promise.all([
      loadLayer(PILOT_CONFIG.layer.url, PILOT_CONFIG.layer.fields, { signal: controller.signal }),
      loadNameCorrespondence(PILOT_CONFIG.correspondenceUrl, { signal: controller.signal }).catch(() => ({})),
    ])
      .then(([validation, correspondence]) => {
        layerSettled.current = true;
        if (!validation.ok) {
          setLayerState({ status: 'error', layer: null, errors: validation.errors, warnings: validation.warnings, correspondence: {} });
          return;
        }
        setLayerState({
          status: 'loaded', layer: validation.layer, errors: [], warnings: validation.warnings, stats: validation.stats, correspondence,
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        layerSettled.current = true;
        setLayerState({ status: 'error', layer: null, errors: [err.message], warnings: [], correspondence: {} });
      });
    return () => {
      controller.abort();
      // Saída do modo real antes do fim do carregamento: tenta de novo na volta.
      if (!layerSettled.current) setLayerState((s) => ({ ...s, status: 'idle' }));
    };
  }, [isReal]);

  /* ---------------- Derivados ---------------- */
  const outage = useMemo(
    () => (isReal ? buildOutageView(outageForm, { defaultAudience: PILOT_CONFIG.territory.name }) : OUTAGE),
    [isReal, outageForm],
  );
  const layerInfo = isReal ? REAL_LAYER_INFO : TERRITORIAL_LAYER;
  const nameOptions = useMemo(() => ({
    // Nomes do operador prevalecem sobre a tabela de correspondência do projeto.
    correspondence: { ...layerState.correspondence, ...storeToCorrespondence(regionStore) },
    officialNameApproved: PILOT_CONFIG.layer.officialNameApproved,
    unitType: PILOT_CONFIG.layer.unitType,
    communityNames: placed.communities,
  }), [layerState.correspondence, regionStore, placed.communities]);

  const traditionalText = useMemo(() => {
    if (!isReal) return buildTraditionalNotice(DEMO_POINTS, OUTAGE);
    if (!result || impMapping.property == null) return '';
    return buildTraditionalFromNames(result.points.map((p) => p.property), outage);
  }, [isReal, result, impMapping.property, outage]);

  const summary = useMemo(() => summarize(result, selectedIds), [result, selectedIds]);
  const selectedUnits = useMemo(
    () => (result ? result.units.filter((u) => selectedIds.includes(u.id)) : []),
    [result, selectedIds],
  );

  /** Carta para as rádios a partir de um conjunto de unidades (na ordem da lista). */
  const letterFor = useCallback((joined, ids, outageView, overrides = announceOverrides) => {
    if (!joined) return { text: '', pendingUnits: [], missingOutage: [], notes: [], items: [] };
    const units = joined.units.filter((u) => ids.includes(u.id));
    const demo = joined.source === 'demo';
    // Comunidades calculadas para ESTE resultado (pode ser um processamento recém-concluído).
    const opts = demo ? nameOptions : { ...nameOptions, communityNames: placesFor(joined).communities };
    const announcement = buildAnnouncement(units, joined.points, {
      nameOf: demo ? (u) => u.name : (u) => resolveSpeakableName(u, opts).name,
      // Cada comunidade vira uma linha de ENDEREÇOS (sem repetir entre regiões).
      namesOf: demo ? null : (u) => resolveSpeakableName(u, opts).names ?? null,
      threshold: ANNOUNCEMENT_RULES.minClientsForRegion,
      overrides,
      clientMapped: !demo && impMapping.client != null,
      propertyMapped: demo || impMapping.property != null,
    });
    return {
      ...buildRadioLetterFromLines(announcement.lines, outageView),
      pendingUnits: announcement.pendingUnits,
      notes: announcement.notes,
      items: announcement.items,
    };
  }, [nameOptions, announceOverrides, impMapping.client, impMapping.property, placesFor]);
  const noticeFor = useCallback((ids) => letterFor(result, ids, outage), [letterFor, result, outage]);

  const currentNotice = useMemo(() => noticeFor(selectedIds), [noticeFor, selectedIds]);

  // Atualiza a carta não editada quando dados do desligamento, nomes ou forma de citação mudam.
  useEffect(() => {
    if (phase !== 'done') return;
    setNotice((prev) => (prev.dirty || prev.text === currentNotice.text
      ? prev
      : { text: currentNotice.text, status: 'draft', dirty: false, stale: false }));
  }, [phase, currentNotice.text]);

  /** Forma de citação de cada unidade (para a lista de regiões). */
  const announcementByUnit = useMemo(() => {
    if (!result) return {};
    const all = letterFor(result, result.units.map((u) => u.id), outage);
    return Object.fromEntries(all.items.map((it) => [it.unit.id, it]));
  }, [result, letterFor, outage]);

  const handleAnnounceMode = (unitId, mode) => {
    setAnnounceOverrides((o) => {
      const next = { ...o };
      if (mode === 'auto') delete next[unitId]; else next[unitId] = mode;
      return next;
    });
    if (notice.status === 'approved') notify('info', 'Forma de citação alterada: a carta voltou para rascunho.');
    if (notice.dirty) setNotice((prev) => ({ ...prev, stale: true, status: 'edited' }));
  };

  /* ---------------- Pontos prioritários ---------------- */
  const priorityAnalysis = useMemo(() => {
    if (!result || !analysisRef || priorityRegistry.status !== 'ready') return null;
    return matchPriorityPoints({
      points: result.points,
      invalidCount: result.invalid ?? 0,
      crs: result.source === 'demo' ? null : analysisRef.crs,
      records: priorityRegistry.records,
      toleranceMeters: Math.min(Number(priorityTolerance), PRIORITY_MATCH.maxToleranceMeters),
      sharedIdField: PRIORITY_MATCH.sharedIdField,
      sharedIdMapped: result.source !== 'demo' && analysisRef.sharedIdMapped,
    });
  }, [result, analysisRef, priorityRegistry.status, priorityRegistry.records, priorityTolerance]);
  const priorityGate = useMemo(
    () => alertGate(priorityAnalysis, priorityRegistry.alerts, analysisRef),
    [priorityAnalysis, priorityRegistry.alerts, analysisRef],
  );

  // Cada alerta da análise atual ganha uma entrada rastreável no histórico.
  const { alerts: priorityAlerts, commitAlerts } = priorityRegistry;
  useEffect(() => {
    if (!priorityAnalysis || !analysisRef) return;
    const next = syncAlerts(priorityAlerts, priorityAnalysis, analysisRef);
    if (next !== priorityAlerts) commitAlerts(next);
  }, [priorityAnalysis, analysisRef, priorityAlerts, commitAlerts]);

  // Um novo alerta de equipamento vital pendente tira a carta do estado "aprovada".
  useEffect(() => {
    if (priorityGate.blocked && notice.status === 'approved') {
      setNotice((prev) => ({ ...prev, status: prev.dirty ? 'edited' : 'draft' }));
      notify('warning', 'Há alerta de equipamento vital pendente: a carta voltou para rascunho.');
    }
  }, [priorityGate.blocked, notice.status, notify]);

  const approvalBlocker = useMemo(() => {
    if (priorityGate.blocked) return priorityGate.message;
    if (!isReal) return null;
    if (hasPlaceholders(notice.text)) {
      return currentNotice.pendingUnits.length
        ? 'Há regiões sem nome nem área do IBGE. Use "Nomear" na lista de regiões ou retire-as da seleção.'
        : 'O texto contém informações pendentes entre colchetes (data, horário ou público). Preencha os dados do desligamento.';
    }
    if (outage.problems?.length) return outage.problems[0];
    return null;
  }, [isReal, notice.text, currentNotice.pendingUnits.length, outage.problems, priorityGate]);

  const focusPriority = useCallback((recordId, force) => {
    setPriorityFocus((cur) => {
      const close = force === false || (force === undefined && cur?.recordId === recordId);
      if (close) return null;
      const alert = priorityAnalysis?.alerts.find((a) => a.recordId === recordId);
      return { recordId, pointKeys: alert?.pointKeys ?? [], nonce: Date.now() };
    });
    if (force !== false) setFocusId(null);
  }, [priorityAnalysis]);

  /** Município, distrito e comunidade de uma coordenada (só no modo real). */
  const placeOf = useCallback((lat, lng) => (isReal && ws.locator && isValidCoordinate(lat, lng) ? ws.locator.locate([lng, lat]) : null), [isReal, ws.locator]);

  // Quando as comunidades mudam (importação, edição), a localização gravada dos
  // pontos prioritários é reavaliada; o operador vê quantos mudaram de comunidade.
  const { records: priorityRecordsAll, commitRecords: commitPriorityRecords, status: priorityStatus } = priorityRegistry;
  useEffect(() => {
    if (!isReal || !ws.locator || priorityStatus !== 'ready') return;
    let moved = 0;
    let filled = 0;
    const at = new Date().toISOString();
    const next = priorityRecordsAll.map((r) => {
      if (!isValidCoordinate(r.lat, r.lng)) return r;
      const snap = placeSnapshot(ws.locator.locate([r.lng, r.lat]), at);
      if (!snap || !placeChanged(r.location, snap)) return r;
      if (!r.location) { filled += 1; return { ...r, location: snap }; }
      moved += 1;
      return {
        ...r,
        location: snap,
        history: [...(r.history ?? []), {
          action: 'localização reavaliada', by: 'sistema', at, fields: [`${r.location.comunidade ?? r.location.rotulo} → ${snap.comunidade ?? snap.rotulo}`],
        }],
      };
    });
    if (moved + filled) {
      commitPriorityRecords(next);
      if (moved) notify('info', `Comunidades alteradas: ${moved} ponto(s) prioritário(s) mudaram de comunidade (registrado no histórico).`);
    }
  }, [isReal, ws.locator, priorityStatus, priorityRecordsAll, commitPriorityRecords, notify]);

  const handleSaveRecord = (value, editingId, typedBy) => {
    const by = authorFor(typedBy);
    try {
      const place = placeOf(value.lat, value.lng);
      const withPlace = place ? { ...value, location: placeSnapshot(place) } : value;
      const next = upsertRecord(priorityRegistry.records, withPlace, { by, editingId });
      if (next === priorityRegistry.records) {
        notify('info', 'Nenhuma alteração para salvar.');
      } else {
        priorityRegistry.commitRecords(next);
        notify('success', editingId ? `Registro ${editingId} atualizado.` : `Ponto prioritário ${value.id} cadastrado.`);
      }
      rememberOperator(by);
      setRegistryNav({ view: 'list' });
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  };

  const handleRecordStatus = (id, status, typedBy) => {
    const by = authorFor(typedBy);
    try {
      priorityRegistry.commitRecords(setRecordStatus(priorityRegistry.records, id, status, { by }));
      rememberOperator(by);
      notify('success', status === 'active' ? `Registro ${id} reativado.` : `Registro ${id} desativado. O histórico foi mantido.`);
      if (status !== 'active' && priorityFocus?.recordId === id) setPriorityFocus(null);
    } catch (err) {
      notify('error', err.message);
    }
  };

  const handleDeleteRecord = (id) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Excluir definitivamente o registro ${id}? Ele nunca gerou alerta.`)) return;
    try {
      priorityRegistry.commitRecords(deleteRecord(priorityRegistry.records, id, priorityRegistry.alerts));
      notify('info', `Registro ${id} excluído.`);
    } catch (err) {
      notify('error', err.message);
    }
  };

  const handleViewRecord = (id) => {
    setRegistryNav(null);
    setLayers((l) => ({ ...l, priority: true }));
    focusPriority(id, true);
    setMobileTab('mapa');
  };

  const handleAlertAction = (key, typedPayload) => {
    const payload = { ...typedPayload, by: authorFor(typedPayload.by) };
    try {
      priorityRegistry.commitAlerts(transitionAlert(priorityRegistry.alerts, key, payload));
      rememberOperator(payload.by);
      notify('success', 'Revisão registrada no histórico do alerta.');
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  };

  const handleResetDemoPriority = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Restaurar os pontos prioritários fictícios da demonstração? Alterações e histórico da demonstração serão descartados.')) return;
    await priorityRegistry.reset();
    setPriorityFocus(null);
    notify('info', 'Exemplos fictícios restaurados.');
  };

  const unitLabel = useCallback((unitId) => {
    const u = result?.units.find((x) => x.id === unitId);
    if (!u) return null;
    const name = result.source === 'demo' ? u.name : resolveSpeakableName(u, nameOptions).name;
    return `Região ${String(u.order).padStart(2, '0')}${name ? ` (${name})` : ''}`;
  }, [result, nameOptions]);

  /* ---------------- Nomes de região ---------------- */
  const persistStore = (next) => {
    setRegionStore(next);
    if (!saveStore(PILOT_CONFIG.territory.ibgeCode, next)) {
      notify('warning', 'Não foi possível salvar no navegador. Exporte os nomes para não perdê-los.');
    }
  };

  const handleRenameRegion = ({
    unit, name, by: typedBy, note,
  }) => {
    const by = authorFor(typedBy);
    try {
      const previousName = resolveSpeakableName(unit, nameOptions).name ?? unit.name ?? null;
      persistStore(renameRegion(regionStore, {
        code: unit.code, name, by, note, previousName,
      }));
      rememberOperator(by);
      notify('success', `Região ${String(unit.order).padStart(2, '0')} nomeada como "${name.trim()}".`);
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  };

  const handleRemoveRegionName = ({ unit, by: typedBy }) => {
    const by = authorFor(typedBy);
    try {
      persistStore(removeRegionName(regionStore, { code: unit.code, by }));
      notify('info', 'Nome do operador removido. O histórico foi mantido.');
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  };

  const handleExportNames = () => {
    const json = exportStore(regionStore, PILOT_CONFIG.territory);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomes_regioes_${PILOT_CONFIG.territory.ibgeCode ?? 'territorio'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('success', `${json.entries.length} nome(s) exportado(s).`);
  };

  const handleImportNames = async (fileObj) => {
    try {
      const json = JSON.parse(await fileObj.text());
      const { store, count } = importStore(regionStore, json, { by: operator || 'importação' });
      persistStore(store);
      notify('success', `${count} nome(s) importado(s).`);
    } catch (err) {
      notify('error', `Não foi possível importar: ${err.message}`);
    }
  };

  /* ---------------- Reinicialização ---------------- */
  const resetResults = () => {
    clearTimers();
    setPhase('idle');
    setResult(null);
    setFocusId(null);
    setSelectedIds([]);
    setNotice(EMPTY_NOTICE);
    setErrorMessage('');
    setAuditOpen(false);
    setPointFilter(DEFAULT_POINT_FILTER);
    setAnnounceOverrides({});
    setAnalysisRef(null);
    setPriorityFocus(null);
    setRegionDetailId(null);
  };

  /** Troca de modo: nenhum resultado é compartilhado entre os modos. */
  const handleModeChange = (next) => {
    if (next === mode || phase === 'processing') return;
    resetResults();
    setLayers(DEFAULT_LAYERS);
    setFile(DEMO_FILE);
    setImp(EMPTY_IMPORT);
    setOutageForm(EMPTY_OUTAGE_FORM);
    setMode(next);
    setMobileTab('dados');
    notify('info', next === 'real'
      ? 'Modo Teste com Dados Reais: dados demonstrativos removidos da tela.'
      : 'Modo Demonstração: dados do teste real descartados da memória.');
  };

  /* ---------------- Importação (demonstração) ---------------- */
  const handleSelectFile = async (selected) => {
    const isCsv = /\.csv$/i.test(selected.name) || selected.type === 'text/csv';
    if (!isCsv) {
      notify('error', 'Formato não suportado. Selecione um arquivo .csv.');
      return;
    }
    if (phase === 'done' || phase === 'error') resetResults();
    setFile({ source: 'user', name: selected.name, records: null, status: 'validating', validation: null });
    try {
      const text = await readFileAsText(selected);
      const validation = validateCoordinates(parseCsv(text));
      const status = !validation.ok ? 'invalid' : validation.invalid > 0 ? 'warning' : 'validated';
      setFile({ source: 'user', name: selected.name, records: validation.total, status, validation });
      if (status === 'invalid') notify('error', 'O arquivo tem problemas e não pode ser usado. Veja os detalhes no painel.');
      else if (status === 'warning') notify('warning', `Arquivo validado com ${validation.invalid} registro(s) inválido(s).`);
      else notify('success', 'Arquivo validado. A simulação continuará usando os dados demonstrativos.');
    } catch (err) {
      setFile({
        source: 'user', name: selected.name, records: null, status: 'invalid',
        validation: { ok: false, total: 0, valid: 0, invalid: 0, missing: [], problems: [err.message] },
      });
      notify('error', err.message);
    }
  };

  const handleUseDemo = () => {
    resetResults();
    setFile(DEMO_FILE);
    notify('info', 'Arquivo demonstrativo carregado na fila.');
  };

  /* ---------------- Importação (dados reais) ---------------- */
  const handleSelectRealFile = async (selected) => {
    if (!/\.(csv|txt|tsv|xlsx|xlsm|xls|ods)$/i.test(selected.name) && selected.type !== 'text/csv') {
      notify('error', 'Formato não suportado. Selecione uma planilha CSV ou Excel (.xlsx).');
      return;
    }
    resetResults();
    const { manual } = imp;
    setImp({
      ...EMPTY_IMPORT, status: 'reading', fileName: selected.name, manual,
    });
    try {
      const book = await readPointsFile(selected);
      const { table, name: sheetName } = book.sheets[book.sheetIndex];
      if (!table.headers.length) throw new Error('O arquivo está vazio ou não pôde ser interpretado como tabela.');
      if (table.headers.length < 2) {
        throw new Error(book.format === 'csv'
          ? 'Foi encontrada apenas uma coluna. Confira se o separador é vírgula, ponto e vírgula ou tabulação.'
          : 'A aba escolhida tem apenas uma coluna.');
      }
      setImp({
        ...EMPTY_IMPORT,
        status: 'parsed',
        fileName: selected.name,
        encoding: book.encoding,
        format: book.format,
        // O conteúdo completo fica só em memória, para validação e processamento.
        sheets: book.sheets,
        sheetIndex: book.sheetIndex,
        parsed: parsedFromTable(table),
        mapping: suggestMapping(table.headers),
        manual,
      });
      const where = book.sheets.length > 1 ? ` da aba "${sheetName}"` : '';
      notify('info', `${table.rows.length} registro(s) lido(s)${where}. Confira o mapeamento e clique em Validar.`);
    } catch (err) {
      setImp({
        ...EMPTY_IMPORT, status: 'error', fileName: selected.name, error: err.message, manual,
      });
      notify('error', err.message);
    }
  };

  const handleSheetChange = (index) => {
    if (phase === 'done' || phase === 'error') resetResults();
    setImp((s) => {
      const table = s.sheets?.[index]?.table;
      if (!table) return s;
      return {
        ...s, sheetIndex: index, parsed: parsedFromTable(table), mapping: suggestMapping(table.headers), status: 'parsed', validation: null, effectiveMapping: null,
      };
    });
  };

  /** Ponto inserido à mão (painel de importação ou coordenada buscada no mapa). */
  const handleAddManualPoint = (p) => {
    if (phase === 'done' || phase === 'error') resetResults();
    setImp((s) => ({
      ...s,
      status: ['empty', 'validated', 'error'].includes(s.status) ? 'parsed' : s.status,
      fileName: s.fileName && s.status !== 'error' ? s.fileName : MANUAL_FILE_NAME,
      error: '',
      validation: null,
      effectiveMapping: null,
      manual: [...s.manual, {
        id: p.id ?? '',
        lat: p.lat ?? '',
        lng: p.lng ?? '',
        client: p.client ?? '',
        property: p.property ?? p.farm?.nome ?? '',
        car: p.car ?? p.farm?.car ?? '',
      }],
    }));
    notify('success', 'Ponto incluído na lista. Valide e processe para vê-lo no resultado.');
    setMobileTab('dados');
  };
  addPointRef.current = handleAddManualPoint;

  const handleRemoveManualPoint = (index) => {
    if (phase === 'done' || phase === 'error') resetResults();
    setImp((s) => {
      const manual = s.manual.filter((_, i) => i !== index);
      if (!manual.length && !s.parsed) return EMPTY_IMPORT;
      return {
        ...s, manual, validation: null, effectiveMapping: null, status: s.status === 'validated' ? 'parsed' : s.status,
      };
    });
  };

  const invalidateValidation = (patch) => {
    if (phase === 'done' || phase === 'error') resetResults();
    setImp((s) => ({
      ...s, ...patch, status: s.status === 'validated' ? 'parsed' : s.status, validation: null, effectiveMapping: null,
    }));
  };
  const handleMappingChange = (key, idx) => invalidateValidation({ mapping: { ...imp.mapping, [key]: idx } });
  const handleCrsChange = (crs) => setImp((s) => ({ ...s, crs }));

  const handleValidate = async () => {
    // Pontos inseridos à mão entram como linhas extras (M1, M2…), nas mesmas regras.
    const { parsed, mapping } = withManualPoints(imp.parsed, imp.mapping, imp.manual);
    // Linha que cita a fazenda (CAR, INCRA, nome, transformador): o catálogo localiza ou confere o ponto.
    let farms = null;
    if (hasFarmMapping(mapping)) {
      try {
        farms = await loadFarmIndex();
      } catch (err) {
        notify('warning', `${err.message} A validação segue sem a busca por fazenda.`);
      }
    }
    const raw = validateRecords(parsed, mapping, { farms });
    const validation = { ...raw, records: raw.records.map((r) => (isManualLine(r.line) ? { ...r, manual: true } : r)) };
    setImp((s) => ({
      ...s, status: 'validated', validation, effectiveMapping: mapping,
    }));
    const fromFarm = validation.fromFarm ? ` ${validation.fromFarm} localizado(s) pela fazenda.` : '';
    if (!validation.ok) notify('error', validation.fileProblems[0] ?? 'Nenhum registro válido.');
    else if (validation.invalid || validation.warnings) {
      notify('warning', `${validation.valid} válido(s), ${validation.invalid} inválido(s), ${validation.warnings} com alerta.${fromFarm}`);
    } else notify('success', `${validation.valid} registro(s) válido(s).${fromFarm}`);
  };

  /* ---------------- Processamento ---------------- */
  const startDemoProcessing = () => {
    PROCESSING_STEPS.forEach((step, i) => {
      if (i > 0) timers.current.push(setTimeout(() => setStepIndex(i), step.at));
    });
    timers.current.push(setTimeout(() => {
      try {
        // Simulação: usa associações predefinidas (ver lib/mockSpatialJoin.js).
        const joined = mockSpatialJoin(DEMO_POINTS, DEMO_TERRITORIES);
        if (joined.units.length === 0) throw new Error('Nenhum ponto correspondeu a uma unidade territorial.');
        finishProcessing(joined);
        if (file.source === 'demo') setFile((f) => ({ ...f, status: 'processed' }));
        notify('success', `Simulação concluída: ${joined.total} pontos em ${joined.units.length} unidades territoriais.`);
        if (joined.geometryMismatches > 0) {
          notify('warning', `${joined.geometryMismatches} ponto(s) fora do polígono associado.`);
        }
      } catch (err) {
        failProcessing(err);
      }
      timers.current = [];
    }, PROCESSING_DURATION_MS));
  };

  const startRealProcessing = () => {
    // Processamento real, síncrono; as pausas curtas só permitem à tela mostrar cada etapa.
    timers.current.push(setTimeout(() => {
      setStepIndex(1);
      timers.current.push(setTimeout(() => {
        try {
          // Cruzamento pela malha de lugares (município → distrito → comunidade); setores só como detalhe.
          const joined = placeJoin(imp.validation, {
            locator: ws.locator,
            sectorLayer: layerState.status === 'loaded' ? layerState.layer : null,
            mapping: impMapping,
          });
          setStepIndex(2);
          if (!joined.checks.unitSumEqualsMatched || !joined.checks.statusSumEqualsValid) {
            throw new Error('Verificação de consistência falhou: as contagens não fecham. Resultado descartado.');
          }
          const view = finishProcessing(joined);
          const parts = [`${joined.matched} associado(s) em ${view.units.length} região(ões)`];
          if (joined.unmatched) parts.push(`${joined.unmatched} sem correspondência`);
          if (joined.ambiguous) parts.push(`${joined.ambiguous} ambíguo(s)`);
          if (joined.fromFarm) parts.push(`${joined.fromFarm} localizado(s) pela fazenda`);
          notify(joined.unmatched || joined.ambiguous ? 'warning' : 'success', `Cruzamento concluído: ${parts.join(', ')}.`);
        } catch (err) {
          failProcessing(err);
        }
        timers.current = [];
      }, 30));
    }, 30));
  };

  /** Guarda o cruzamento e monta a carta inicial; devolve as regiões exibidas (microrregiões no modo real). */
  const finishProcessing = (joined) => {
    const view = placesFor(joined).placed;
    const ids = view.units.map((u) => u.id);
    prevUnits.current = { key: ids.join('|'), ids };
    setResult(joined);
    setSelectedIds(ids);
    setPhase('done');
    // Celular: com pelo menos uma região, a tela principal passa a ser a lista de regiões.
    // Sem regiões, permanece em Dados, onde o motivo é exibido.
    if (ids.length > 0) setMobileTab('regioes');
    // O texto inicial é montado a partir do resultado recém-calculado.
    const outageView = joined.source === 'demo'
      ? OUTAGE
      : buildOutageView(outageForm, { defaultAudience: PILOT_CONFIG.territory.name });
    const { text } = letterFor(view, ids, outageView, {});
    setNotice({ text, status: 'draft', dirty: false, stale: false });
    // Referência do desligamento usada nos alertas de pontos prioritários.
    setAnalysisRef({
      ...buildAnalysisRef({
        outageId: outageView.id,
        dateLabel: outageView.dateLabel,
        fileName: joined.source === 'demo' ? DEMO_FILE_NAME : (imp.fileName || MANUAL_FILE_NAME),
        processedAt: joined.processedAt ?? new Date().toISOString(),
      }),
      crs: joined.source === 'demo' ? null : effectiveCrs(imp),
      sharedIdMapped: joined.source !== 'demo' && impMapping[PRIORITY_MATCH.sharedIdField] != null,
    });
    return view;
  };

  const failProcessing = (err) => {
    setPhase('error');
    setErrorMessage(err.message);
    notify('error', err.message);
  };

  const handleProcess = () => {
    if (phase === 'processing') return;
    if (!isReal && file.status === 'invalid') {
      notify('error', 'Corrija o arquivo ou use o arquivo demonstrativo antes de processar.');
      return;
    }
    if (isReal) {
      if (!ws.locator) { notify('error', 'A malha de municípios e comunidades ainda está carregando.'); return; }
      if (!isProcessableCrs(effectiveCrs(imp))) { notify('error', 'Declare o referencial das coordenadas antes de processar.'); return; }
      if (!imp.validation?.ok) { notify('error', 'Valide o arquivo antes de processar.'); return; }
    }
    clearTimers();
    setErrorMessage('');
    setPhase('processing');
    setStepIndex(0);
    if (isReal) startRealProcessing();
    else startDemoProcessing();
  };

  const handleCancel = () => {
    clearTimers();
    setPhase('idle');
    notify('info', 'Processamento cancelado. Nenhum resultado foi gerado.');
  };

  const handleReset = () => {
    resetResults();
    setFile(DEMO_FILE);
    setLayers(DEFAULT_LAYERS);
    notify('info', 'Demonstração reiniciada.');
  };

  const handleRealReset = () => {
    resetResults();
    setImp(EMPTY_IMPORT);
    notify('info', 'Resultado descartado. Selecione um novo arquivo.');
  };

  /* ---------------- Seleção de regiões ---------------- */
  const handleFocus = useCallback((id) => {
    setFocusId((cur) => (cur === id ? null : id));
    setPriorityFocus(null);
  }, []);

  /** Aplica uma nova seleção e mantém o aviso coerente com ela. */
  const applySelection = (ids) => {
    setSelectedIds(ids);
    if (notice.status === 'approved') notify('info', 'Seleção alterada: o aviso voltou para rascunho.');
    setNotice((prev) => {
      if (!prev.dirty) {
        return { text: noticeFor(ids).text, status: 'draft', dirty: false, stale: false };
      }
      return { ...prev, stale: true, status: 'edited' };
    });
  };

  const handleToggleSelected = (id) => {
    const ids = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    applySelection(result.units.map((u) => u.id).filter((x) => ids.includes(x)));
  };
  const handleSelectAll = () => applySelection(result.units.map((u) => u.id));
  const handleClearSelection = () => applySelection([]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || auditOpen || registryNav || ws.modalOpen || ws.editing) return;
      if (focusId) setFocusId(null);
      if (priorityFocus) setPriorityFocus(null);
      setRegionDetailId(null);
      ws.closeTransient();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId, auditOpen, registryNav, priorityFocus, ws]);

  /* ---------------- Navegação no celular ---------------- */
  const openRegionDetail = (id) => {
    setRegionDetailId(id);
    setFocusId(id);
    setPriorityFocus(null);
    setMobileTab('regioes');
  };
  const closeRegionDetail = () => {
    setRegionDetailId(null);
    setFocusId(null);
  };
  /** "Ver no mapa": troca para a tela Mapa e foca a região (a câmera voa quando o mapa aparece). */
  const showRegionOnMap = (id) => {
    setFocusId(id);
    setPriorityFocus(null);
    setMobileTab('mapa');
  };

  /* ---------------- Aviso ---------------- */
  const handleNoticeChange = (text) => {
    if (notice.status === 'approved') notify('info', 'Texto alterado: aprove novamente quando terminar.');
    setNotice((prev) => ({ ...prev, text, dirty: true, status: 'edited' }));
  };

  const handleGenerate = () => {
    if (!selectedUnits.length) {
      notify('warning', 'Selecione pelo menos uma unidade territorial para gerar o aviso.');
      return;
    }
    setNotice({ text: currentNotice.text, status: 'draft', dirty: false, stale: false });
    notify('success', `Carta gerada com ${selectedUnits.length} região(ões).`);
    if (currentNotice.pendingUnits.length) {
      notify('warning', `${currentNotice.pendingUnits.length} região(ões) sem nome. Nomeie-as na lista de regiões.`);
    }
  };

  const handleCopy = async () => {
    const text = notice.text;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (!ok) throw new Error('copy failed');
      }
      notify('success', 'Texto copiado para a área de transferência.');
    } catch {
      notify('error', 'Não foi possível copiar. Selecione o texto e use Ctrl+C.');
    }
  };

  const handleApprove = () => {
    if (!notice.text.trim() || !selectedUnits.length || approvalBlocker) return;
    // Com identidade do Access, a aprovação registra quem aprovou (só em memória).
    setNotice((prev) => ({
      ...prev, status: 'approved', approvedBy: identity?.email ?? null, approvedAt: new Date().toISOString(),
    }));
    notify('success', isReal
      ? 'Carta aprovada no ambiente de teste. Nenhuma mensagem foi enviada.'
      : 'Carta aprovada para demonstração. Nenhuma mensagem foi enviada.');
  };

  const closeRegistry = useCallback(() => setRegistryNav(null), []);

  /* ---------------- Selos da barra inferior (celular) ---------------- */
  const pendingAlertCount = useMemo(() => {
    if (!priorityAnalysis || priorityAnalysis.blocked || !analysisRef) return 0;
    return priorityAnalysis.alerts.filter(
      (a) => (priorityRegistry.alerts[alertKey(analysisRef.key, a.recordId)]?.status ?? 'novo') !== 'concluido',
    ).length;
  }, [priorityAnalysis, analysisRef, priorityRegistry.alerts]);
  const noticeHasIssues = phase === 'done' && (!!approvalBlocker || currentNotice.pendingUnits.length > 0 || selectedUnits.length === 0);
  const navBadges = {
    regioes: phase === 'done' && result?.units.length ? { count: result.units.length, label: `${result.units.length} região(ões)` } : null,
    aviso: noticeHasIssues ? { dot: true, tone: 'danger', label: 'há pendências' } : null,
    alertas: pendingAlertCount ? { count: pendingAlertCount, tone: 'danger', label: `${pendingAlertCount} pendente(s)` } : null,
  };
  /** Classe de cada tela: abaixo de lg só a tela ativa aparece; a partir de lg nada muda. */
  const screen = (...tabs) => (tabs.includes(mobileTab) ? '' : 'max-lg:hidden');
  const mapScreen = mobileTab === 'mapa';

  /* ---------------- Layout ---------------- */
  // Modo real: setores da camada oficial + contornos das regiões por microrregião (por cima).
  const territories = useMemo(() => {
    if (!isReal) return DEMO_TERRITORIES;
    const layer = layerState.layer;
    if (!layer || !result?.features?.length) return layer;
    return { ...layer, features: [...layer.features, ...result.features] };
  }, [isReal, layerState.layer, result]);

  return (
    <div className="cr-app flex min-h-screen flex-col bg-slate-100 font-sans text-petrol-900">
      <a
        href="#conteudo"
        className="sr-only z-[1300] rounded-md bg-petrol-800 px-3 py-2 text-[13px] font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Pular para o conteúdo
      </a>
      <Header
        mode={mode}
        onModeChange={handleModeChange}
        modeLocked={phase === 'processing'}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        identity={identity}
      />

      <main
        id="conteudo"
        tabIndex={-1}
        ref={mainRef}
        onScroll={(e) => { scrollByScreen.current[screenKeyRef.current] = e.currentTarget.scrollTop; }}
        className={`grid flex-1 grid-cols-1 content-start gap-3 p-3 focus:outline-none lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)] max-lg:min-h-0 max-lg:overflow-x-hidden max-lg:overscroll-contain ${
          mapScreen
            ? 'max-lg:flex max-lg:flex-col max-lg:overflow-y-hidden max-lg:p-0'
            : 'max-lg:overflow-y-auto max-lg:pl-[max(0.75rem,env(safe-area-inset-left))] max-lg:pr-[max(0.75rem,env(safe-area-inset-right))]'
        }`}
      >
        {/* Coluna esquerda: importação e informações (celular: telas Dados e Alertas) */}
        {/* No computador a coluna fica parada sob o cabeçalho e rola sozinha: o mapa não sai da tela ao ler os alertas. */}
        <aside
          className={`flex flex-col gap-3 lg:sticky lg:top-[calc(3.5rem+1px+0.75rem)] lg:row-span-3 lg:max-h-[calc(100vh-3.5rem-1px-1.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain ${screen('dados', 'alertas')}`}
          aria-label="Importação e informações do desligamento"
        >
          <section className={`rounded-md border border-slate-200 bg-white px-3.5 py-3 shadow-panel lg:hidden ${screen('dados')}`} aria-label="Modo de operação">
            <p className="mb-1.5 text-[13px] font-semibold text-petrol-900">Modo de operação</p>
            <ModeSwitch mode={mode} onModeChange={handleModeChange} modeLocked={phase === 'processing'} />
          </section>
          {phase === 'done' && result && result.units.length === 0 && (
            <p className={`flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-[14px] leading-snug text-amber-900 lg:hidden ${screen('dados')}`} role="status">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Processamento concluído sem regiões: nenhum ponto ficou associado a uma única unidade territorial.
              {isReal ? ' Abra a Auditoria para ver os motivos de cada registro.' : ''}
            </p>
          )}
          <div className={screen('dados')}>
          {isReal ? (
            <RealImportPanel
              imp={imp}
              layerState={layerState}
              phase={phase}
              stepIndex={stepIndex}
              errorMessage={errorMessage}
              placesReady={!!ws.locator}
              needsCrs={!imp.validation || needsDeclaredCrs(imp.validation)}
              onSelectFile={handleSelectRealFile}
              onSheetChange={handleSheetChange}
              onAddManual={handleAddManualPoint}
              onRemoveManual={handleRemoveManualPoint}
              onMappingChange={handleMappingChange}
              onCrsChange={handleCrsChange}
              onValidate={handleValidate}
              onProcess={handleProcess}
              onReset={handleRealReset}
              onOpenAudit={() => setAuditOpen(true)}
            />
          ) : (
            <CsvUpload
              file={file}
              phase={phase}
              stepIndex={stepIndex}
              errorMessage={errorMessage}
              onSelectFile={handleSelectFile}
              onUseDemo={handleUseDemo}
              onProcess={handleProcess}
              onCancel={handleCancel}
              onReset={handleReset}
            />
          )}
          </div>
          <div className={screen('alertas')}>
          <PriorityAlertsPanel
            mode={mode}
            phase={phase}
            registry={priorityRegistry}
            analysis={priorityAnalysis}
            analysisRef={analysisRef}
            gate={priorityGate}
            tolerance={priorityTolerance}
            onToleranceChange={setPriorityTolerance}
            toleranceLimits={{ max: PRIORITY_MATCH.maxToleranceMeters }}
            focusedRecordId={priorityFocus?.recordId ?? null}
            onFocusRecord={focusPriority}
            onAction={handleAlertAction}
            operator={operator}
            operatorLocked={operatorLocked}
            onOpenRegistry={setRegistryNav}
            unitLabel={unitLabel}
            onShowOnMap={handleViewRecord}
          />
          </div>
          <div className={`flex flex-col gap-3 ${screen('dados')}`}>
          {isReal
            ? (
              <OutageForm
                form={outageForm}
                view={outage}
                defaultAudience={PILOT_CONFIG.territory.name}
                onChange={(k, v) => setOutageForm((f) => ({ ...f, [k]: v }))}
              />
            )
            : <OutageInfo outage={OUTAGE} />}
          <Timeline outage={outage} phase={phase} noticeStatus={notice.status} mode={mode} priorityPending={priorityGate.blocked} />
          </div>
        </aside>

        {/* Centro: indicadores e mapa (celular: tela Mapa, em tela cheia) */}
        {/* Fora da tela Mapa, no celular, o mapa fica invisível mas com o tamanho real (mesma área da tela),
            para o Leaflet nunca ficar com tamanho zero; a câmera continua acompanhando o foco. */}
        <div
          className={`flex min-h-0 flex-col gap-3 ${mapScreen
            ? 'max-lg:flex-1'
            : 'max-lg:pointer-events-none max-lg:invisible max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(var(--cr-nav-h)+env(safe-area-inset-bottom))] max-lg:top-[calc(3.5rem+1px+env(safe-area-inset-top))]'}`}
          aria-hidden={isMobile && !mapScreen ? true : undefined}
        >
          <div className="max-lg:hidden">
            <KpiCards result={result} summary={summary} phase={phase} outage={outage} mode={mode} />
          </div>
          <MapView
            className="max-lg:min-h-0 max-lg:rounded-none max-lg:border-0 max-lg:shadow-none"
            visible={!isMobile || mapScreen}
            compact={isMobile}
            onOpenDetails={openRegionDetail}
            key={`${mode}|${layerState.status}`}
            mode={mode}
            phase={phase}
            result={result}
            territories={territories}
            layerState={layerState}
            layers={layers}
            onToggleLayer={(key) => setLayers((l) => ({ ...l, [key]: !l[key] }))}
            pointFilter={pointFilter}
            onTogglePointFilter={(key) => setPointFilter((f) => ({ ...f, [key]: !f[key] }))}
            focusId={focusId}
            onFocus={handleFocus}
            selectedIds={selectedIds}
            layerInfo={layerInfo}
            nameOf={isReal ? (u) => resolveSpeakableName(u, nameOptions).name : (u) => u.name}
            dark={theme === 'dark'}
            priorityRecords={priorityRecordsActive}
            priorityAnalysis={priorityAnalysis}
            priorityFocus={priorityFocus}
            onPriorityFocus={(id) => focusPriority(id)}
            basemap={ws.basemap}
            opPanes={ws.opPanes}
            opOpacity={ws.opOpacity}
            mapChildren={ws.mapChildren}
            layerPanel={ws.layerPanel}
            overlay={<>{ws.overlay}{ws.mobileSearch}</>}
            headerActions={ws.headerActions}
            mobileActions={ws.mobileActions}
            sectorTooltips={!ws.communitiesVisible}
            editing={ws.editing}
          />
        </div>

        {/* Celular: indicadores compactos no topo da tela Regiões */}
        <div className={`lg:hidden ${mobileTab === 'regioes' && !regionDetailId ? '' : 'max-lg:hidden'}`}>
          <KpiStrip result={result} summary={summary} phase={phase} outage={outage} mode={mode} />
        </div>

        {/* Direita: resultados territoriais (celular: tela Regiões) */}
        <RegionPanel
          className={`lg:col-start-2 ${screen('regioes')}`}
          mobile={isMobile}
          detailId={regionDetailId}
          onOpenDetail={openRegionDetail}
          onCloseDetail={closeRegionDetail}
          onShowOnMap={showRegionOnMap}
          mode={mode}
          phase={phase}
          result={result}
          summary={summary}
          focusId={focusId}
          onFocus={handleFocus}
          selectedIds={selectedIds}
          onToggleSelected={handleToggleSelected}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          layerInfo={layerInfo}
          layerState={layerState}
          nameOptions={nameOptions}
          regionStore={regionStore}
          announcementByUnit={announcementByUnit}
          announceThreshold={ANNOUNCEMENT_RULES.minClientsForRegion}
          onAnnounceMode={handleAnnounceMode}
          operator={operator}
          operatorLocked={operatorLocked}
          onRenameRegion={handleRenameRegion}
          onRemoveRegionName={handleRemoveRegionName}
          onExportNames={handleExportNames}
          onImportNames={handleImportNames}
          onOpenAudit={() => setAuditOpen(true)}
        />

        {/* Inferior: comunicação (celular: tela Aviso) */}
        <div className={`lg:col-start-2 ${screen('aviso')}`}>
          <CommunicationPanel
            mode={mode}
            phase={phase}
            result={result}
            traditionalText={traditionalText}
            propertyMapped={!isReal || impMapping.property != null}
            notice={notice}
            onNoticeChange={handleNoticeChange}
            onGenerate={handleGenerate}
            onCopy={handleCopy}
            onApprove={handleApprove}
            selectedCount={selectedUnits.length}
            pendingUnits={isReal ? currentNotice.pendingUnits : []}
            notes={currentNotice.notes}
            approvalBlocker={approvalBlocker}
          />
        </div>
      </main>

      {isReal && (
        <AuditDialog
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
          result={result}
          summary={summary}
          layerInfo={layerInfo}
          onFocusUnit={(id) => { setFocusId(id); setMobileTab('mapa'); }}
        />
      )}
      <PriorityRegistry
        open={!!registryNav}
        view={registryNav?.view ?? 'list'}
        editingId={registryNav?.editingId ?? null}
        prefill={registryNav?.prefill ?? null}
        mode={mode}
        records={priorityRegistry.records}
        alerts={priorityRegistry.alerts}
        operator={operator}
        operatorLocked={operatorLocked}
        duplicateWarningMeters={PRIORITY_MATCH.duplicateWarningMeters}
        onClose={closeRegistry}
        onNavigate={setRegistryNav}
        onSave={handleSaveRecord}
        placeOf={placeOf}
        onSetStatus={handleRecordStatus}
        onDelete={handleDeleteRecord}
        onViewOnMap={handleViewRecord}
        onResetDemo={isReal ? null : handleResetDemoPriority}
      />
      {ws.dialogs}
      <MobileNav active={mobileTab} onChange={setMobileTab} badges={navBadges} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
