import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import CsvUpload from './components/CsvUpload.jsx';
import RealImportPanel from './components/RealImportPanel.jsx';
import OutageInfo from './components/OutageInfo.jsx';
import OutageForm from './components/OutageForm.jsx';
import Timeline from './components/Timeline.jsx';
import KpiCards from './components/KpiCards.jsx';
import MapView from './components/MapView.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import CommunicationPanel from './components/CommunicationPanel.jsx';
import AuditDialog from './components/AuditDialog.jsx';
import Toasts from './components/Toasts.jsx';
import {
  OUTAGE, DEMO_FILE_NAME, DEMO_POINTS, DEMO_TERRITORIES,
} from './data/mockData.js';
import {
  TERRITORIAL_LAYER, PROCESSING_STEPS, PROCESSING_DURATION_MS, PILOT_CONFIG, PILOT_STATUS_LABEL, ANNOUNCEMENT_RULES,
} from './config.js';
import { mockSpatialJoin } from './lib/mockSpatialJoin.js';
import { spatialJoin } from './lib/spatialJoin.js';
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
  parseCsv, validateCoordinates, readFileAsText, readFileWithEncoding, suggestMapping, validateRecords, isProcessableCrs,
} from './lib/csv.js';
import { buildOutageView, EMPTY_OUTAGE_FORM } from './lib/outage.js';
import { summarize, DEFAULT_POINT_FILTER } from './lib/summary.js';
import { useTheme } from './lib/theme.js';

const DEMO_FILE = {
  source: 'demo',
  name: DEMO_FILE_NAME,
  records: DEMO_POINTS.length,
  status: 'queued',
  validation: null,
};
const EMPTY_NOTICE = { text: '', status: 'draft', dirty: false, stale: false };
const DEFAULT_LAYERS = { points: true, territories: true };
const EMPTY_IMPORT = {
  status: 'empty', fileName: '', encoding: '', parsed: null, mapping: {}, crs: '', validation: null, error: '',
};

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
  const [result, setResult] = useState(null);
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
  const [outageForm, setOutageForm] = useState(EMPTY_OUTAGE_FORM);
  const [layerState, setLayerState] = useState({ status: 'idle', layer: null, errors: [], warnings: [], correspondence: {} });
  // Nomes de região definidos pelo operador (salvos neste navegador, com histórico).
  const [regionStore, setRegionStore] = useState(() => loadStore(PILOT_CONFIG.territory.ibgeCode));
  const [operator, setOperator] = useState(() => loadOperator());

  const isReal = mode === 'real';
  const timers = useRef([]);
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
  }), [layerState.correspondence, regionStore]);

  const traditionalText = useMemo(() => {
    if (!isReal) return buildTraditionalNotice(DEMO_POINTS, OUTAGE);
    if (!result || imp.mapping.property == null) return '';
    return buildTraditionalFromNames(result.points.map((p) => p.property), outage);
  }, [isReal, result, imp.mapping.property, outage]);

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
    const announcement = buildAnnouncement(units, joined.points, {
      nameOf: demo ? (u) => u.name : (u) => resolveSpeakableName(u, nameOptions).name,
      threshold: ANNOUNCEMENT_RULES.minClientsForRegion,
      overrides,
      clientMapped: !demo && imp.mapping.client != null,
      propertyMapped: demo || imp.mapping.property != null,
    });
    return {
      ...buildRadioLetterFromLines(announcement.lines, outageView),
      pendingUnits: announcement.pendingUnits,
      notes: announcement.notes,
      items: announcement.items,
    };
  }, [nameOptions, announceOverrides, imp.mapping.client, imp.mapping.property]);
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

  const approvalBlocker = useMemo(() => {
    if (!isReal) return null;
    if (hasPlaceholders(notice.text)) {
      return currentNotice.pendingUnits.length
        ? 'Há regiões sem nome nem área do IBGE. Use "Nomear" na lista de regiões ou retire-as da seleção.'
        : 'O texto contém informações pendentes entre colchetes (data, horário ou público). Preencha os dados do desligamento.';
    }
    if (outage.problems?.length) return outage.problems[0];
    return null;
  }, [isReal, notice.text, currentNotice.pendingUnits.length, outage.problems]);

  /* ---------------- Nomes de região ---------------- */
  const persistStore = (next) => {
    setRegionStore(next);
    if (!saveStore(PILOT_CONFIG.territory.ibgeCode, next)) {
      notify('warning', 'Não foi possível salvar no navegador. Exporte os nomes para não perdê-los.');
    }
  };

  const handleRenameRegion = ({ unit, name, by, note }) => {
    try {
      const previousName = resolveSpeakableName(unit, nameOptions).name ?? unit.name ?? null;
      persistStore(renameRegion(regionStore, {
        code: unit.code, name, by, note, previousName,
      }));
      setOperator(by.trim());
      saveOperator(by);
      notify('success', `Região ${String(unit.order).padStart(2, '0')} nomeada como "${name.trim()}".`);
      return true;
    } catch (err) {
      notify('error', err.message);
      return false;
    }
  };

  const handleRemoveRegionName = ({ unit, by }) => {
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
    if (!/\.csv$/i.test(selected.name) && selected.type !== 'text/csv') {
      notify('error', 'Formato não suportado. Selecione um arquivo .csv.');
      return;
    }
    resetResults();
    setImp({ ...EMPTY_IMPORT, status: 'reading', fileName: selected.name });
    try {
      const { text, encoding } = await readFileWithEncoding(selected);
      const parsed = parseCsv(text);
      if (!parsed.headers.length) throw new Error('O arquivo está vazio ou não pôde ser interpretado como CSV.');
      if (parsed.headers.length < 2) {
        throw new Error('Foi encontrada apenas uma coluna. Confira se o separador é vírgula, ponto e vírgula ou tabulação.');
      }
      setImp({
        ...EMPTY_IMPORT,
        status: 'parsed',
        fileName: selected.name,
        encoding,
        // O conteúdo completo fica só em memória, para validação e processamento.
        parsed: { ...parsed, rowCount: parsed.rows.length, preview: parsed.rows.slice(0, 5) },
        mapping: suggestMapping(parsed.headers),
      });
      notify('info', `${parsed.rows.length} registro(s) lido(s). Confira o mapeamento e o referencial e clique em Validar.`);
    } catch (err) {
      setImp({ ...EMPTY_IMPORT, status: 'error', fileName: selected.name, error: err.message });
      notify('error', err.message);
    }
  };

  const invalidateValidation = (patch) => {
    if (phase === 'done' || phase === 'error') resetResults();
    setImp((s) => ({ ...s, ...patch, status: s.status === 'validated' ? 'parsed' : s.status, validation: null }));
  };
  const handleMappingChange = (key, idx) => invalidateValidation({ mapping: { ...imp.mapping, [key]: idx } });
  const handleCrsChange = (crs) => setImp((s) => ({ ...s, crs }));

  const handleValidate = () => {
    const validation = validateRecords(imp.parsed, imp.mapping);
    setImp((s) => ({ ...s, status: 'validated', validation }));
    if (!validation.ok) notify('error', validation.fileProblems[0] ?? 'Nenhum registro válido.');
    else if (validation.invalid || validation.warnings) {
      notify('warning', `${validation.valid} válido(s), ${validation.invalid} inválido(s), ${validation.warnings} com alerta.`);
    } else notify('success', `${validation.valid} registro(s) válido(s).`);
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
          const joined = spatialJoin(imp.validation, layerState.layer, { mapping: imp.mapping });
          setStepIndex(2);
          if (!joined.checks.unitSumEqualsMatched || !joined.checks.statusSumEqualsValid) {
            throw new Error('Verificação de consistência falhou: as contagens não fecham. Resultado descartado.');
          }
          finishProcessing(joined);
          const parts = [`${joined.matched} associado(s) em ${joined.units.length} unidade(s)`];
          if (joined.unmatched) parts.push(`${joined.unmatched} sem correspondência`);
          if (joined.ambiguous) parts.push(`${joined.ambiguous} ambíguo(s)`);
          notify(joined.unmatched || joined.ambiguous ? 'warning' : 'success', `Cruzamento concluído: ${parts.join(', ')}.`);
        } catch (err) {
          failProcessing(err);
        }
        timers.current = [];
      }, 30));
    }, 30));
  };

  const finishProcessing = (joined) => {
    const ids = joined.units.map((u) => u.id);
    setResult(joined);
    setSelectedIds(ids);
    setPhase('done');
    // O texto inicial é montado a partir do resultado recém-calculado.
    const outageView = joined.source === 'demo'
      ? OUTAGE
      : buildOutageView(outageForm, { defaultAudience: PILOT_CONFIG.territory.name });
    const { text } = letterFor(joined, ids, outageView, {});
    setNotice({ text, status: 'draft', dirty: false, stale: false });
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
      if (layerState.status !== 'loaded') { notify('error', 'A camada territorial oficial não está carregada.'); return; }
      if (!isProcessableCrs(imp.crs)) { notify('error', 'Declare o referencial das coordenadas antes de processar.'); return; }
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
  const handleFocus = useCallback((id) => setFocusId((cur) => (cur === id ? null : id)), []);

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
      if (e.key === 'Escape' && focusId && !auditOpen) setFocusId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId, auditOpen]);

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
    setNotice((prev) => ({ ...prev, status: 'approved' }));
    notify('success', isReal
      ? 'Carta aprovada no ambiente de teste. Nenhuma mensagem foi enviada.'
      : 'Carta aprovada para demonstração. Nenhuma mensagem foi enviada.');
  };

  /* ---------------- Layout ---------------- */
  const territories = isReal ? layerState.layer : DEMO_TERRITORIES;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 font-sans text-petrol-900 2xl:h-screen 2xl:min-h-[860px]">
      <Header
        mode={mode}
        onModeChange={handleModeChange}
        modeLocked={phase === 'processing'}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
      />

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_330px] 2xl:min-h-0 2xl:grid-cols-[300px_minmax(0,1fr)_360px] 2xl:grid-rows-[minmax(0,1fr)_304px]">
        {/* Coluna esquerda: importação e informações */}
        <aside className="flex flex-col gap-3 lg:row-span-3 xl:row-span-2 2xl:min-h-0 2xl:overflow-y-auto" aria-label="Importação e informações do desligamento">
          {isReal ? (
            <RealImportPanel
              imp={imp}
              layerState={layerState}
              phase={phase}
              stepIndex={stepIndex}
              errorMessage={errorMessage}
              onSelectFile={handleSelectRealFile}
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
          <Timeline outage={outage} phase={phase} noticeStatus={notice.status} mode={mode} />
        </aside>

        {/* Centro: indicadores e mapa */}
        <div className="flex min-h-0 flex-col gap-3">
          <KpiCards result={result} summary={summary} phase={phase} outage={outage} mode={mode} />
          <MapView
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
          />
        </div>

        {/* Direita: resultados territoriais */}
        <RegionPanel
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
          onRenameRegion={handleRenameRegion}
          onRemoveRegionName={handleRemoveRegionName}
          onExportNames={handleExportNames}
          onImportNames={handleImportNames}
          onOpenAudit={() => setAuditOpen(true)}
        />

        {/* Inferior: comunicação */}
        <div className="lg:col-start-2 xl:col-span-2 2xl:min-h-0">
          <CommunicationPanel
            mode={mode}
            phase={phase}
            result={result}
            traditionalText={traditionalText}
            propertyMapped={!isReal || imp.mapping.property != null}
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
          onFocusUnit={(id) => setFocusId(id)}
        />
      )}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
