import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, GeoJSON, Rectangle,
} from 'react-leaflet';
import L from 'leaflet';
import {
  X, Upload, FileUp, LoaderCircle, TriangleAlert, CircleCheck, Download, Info, Link2,
} from 'lucide-react';
import { request } from '../../lib/layers/workerClient.js';
import { kmlTextToGeoJSON, kmzToGeoJSON } from '../../lib/layers/kml.js';
import {
  ACCEPTED_EXTENSIONS, detectKind, KIND_LABEL, FAMILY_LABEL,
} from '../../lib/layers/importEngine.js';
import { KNOWN_CRS, utmZoneForLng } from '../../lib/layers/crs.js';
import {
  VISIBILITY, SYMBOLS, defaultStyleFor, CATEGORY_PALETTE,
} from '../../lib/layers/layerModel.js';
import { BASEMAPS, DATA_LAYER_LIMITS } from '../../config.js';
import { bboxToBounds } from '../../lib/geo.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';

const fmt = (n) => Number(n ?? 0).toLocaleString('pt-BR');
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function downloadCsv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = ['referencia;motivo', ...rows.map((r) => `${esc(r.ref)};${esc(r.reason)}`)].join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Envio de camada (arquivo ou URL), com pré-visualização antes de confirmar.
 * target: null (camada nova) ou camada existente (atualizar: substituir/anexar).
 */
export default function LayerUploadDialog({
  open, target = null, groupPaths = [], existingCount = 0, by, onClose, onSaved, onSavedExternal, newId,
}) {
  const [tab, setTab] = useState('file');
  const [phase, setPhase] = useState('pick'); // pick | reading | columns | crs | preview | committing | done | error
  const [progress, setProgress] = useState({ value: 0, stage: '' });
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState(null);
  const [info, setInfo] = useState(null); // resposta do worker
  const [options, setOptions] = useState({});
  const [keep, setKeep] = useState({});
  const [showRejected, setShowRejected] = useState(false);
  const [form, setForm] = useState({});
  const [mode, setMode] = useState('replace');
  const jobId = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setTab('file'); setPhase('pick'); setError(''); setFile(null); setInfo(null); setOptions({}); setKeep({}); setShowRejected(false); setMode('replace');
    jobId.current = `job-${Date.now()}`;
    setForm({
      name: '', description: '', group: groupPaths[0] ?? '', visibility: 'organization', ...defaultStyleFor('point', existingCount), minZoom: '',
    });
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'committing') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      request('import:discard', { jobId: jobId.current }).catch(() => {});
    };
    // Reinicia só na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const read = async (f, k, opts) => {
    setPhase('reading');
    setError('');
    setProgress({ value: 0, stage: 'Lendo o arquivo' });
    try {
      let payload = {
        jobId: jobId.current, kind: k, options: opts,
      };
      let transfer = [];
      if (f) {
        if (k === 'kml') payload.geojson = kmlTextToGeoJSON(await f.text());
        else if (k === 'kmz') payload.geojson = kmzToGeoJSON(await f.arrayBuffer());
        else {
          const buf = await f.arrayBuffer();
          payload = { ...payload, bytes: buf };
          transfer = [buf];
        }
      }
      const res = await request('import:read', payload, { onProgress: (value, stage) => setProgress({ value, stage }), transfer });
      setInfo(res);
      if (res.needsColumns) { setPhase('columns'); return; }
      if (res.needsCrs) { setPhase('crs'); return; }
      setKeep(Object.fromEntries(res.attributes.map((a) => [a.name, true])));
      const fam = res.stats.geometryType === 'mixed' ? 'point' : res.stats.geometryType;
      setForm((fm) => ({
        ...fm,
        ...(target ? {} : defaultStyleFor(fam, existingCount)),
        color: fm.color,
        name: fm.name || (res.layerName ?? f?.name ?? file?.name ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
        minZoom: fm.minZoom,
      }));
      setPhase('preview');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  };

  const onPickFile = (f) => {
    if (!f) return;
    const k = detectKind(f.name);
    if (!k) { setError('Formato não reconhecido. Use GeoJSON, KML/KMZ, Shapefile (.zip), CSV ou GeoPackage.'); setPhase('error'); return; }
    if (f.size > DATA_LAYER_LIMITS.maxFileBytes) { setError(`Arquivo grande demais (${mb(f.size)}). Limite: ${mb(DATA_LAYER_LIMITS.maxFileBytes)}.`); setPhase('error'); return; }
    setFile(f);
    setKind(k);
    setOptions({});
    read(f, k, {});
  };

  const reread = (patch) => {
    const next = { ...options, ...patch };
    setOptions(next);
    read(null, kind, next);
  };

  const commit = async () => {
    const name = form.name.trim();
    if (!target && name.length < 2) { setError('Informe o nome da camada.'); return; }
    setError('');
    setPhase('committing');
    const layerId = target?.id ?? newId();
    const version = (target?.currentVersion ?? 0) + 1;
    const keepFields = Object.entries(keep).filter(([, v]) => v).map(([k]) => k);
    try {
      const res = await request('import:commit', {
        jobId: jobId.current, layerId, version, keepFields, appendTo: target && mode === 'append' ? target.currentVersion : null,
      }, { onProgress: (value, stage) => setProgress({ value, stage }) });
      await onSaved({
        layerId,
        version,
        mode: target ? mode : 'create',
        result: res,
        form: { ...form, name },
        upload: {
          fileName: file?.name ?? '', kind, originalCrs: info.crs, rejectedCount: info.rejectedTotal, fixedCount: info.stats.fixed, acceptedCount: info.stats.accepted, rejected: info.rejected.slice(0, 200),
        },
      });
      setPhase('done');
    } catch (err) {
      setError(err.message);
      setPhase('preview');
    }
  };

  const busy = phase === 'reading' || phase === 'committing';
  const title = target ? `Atualizar dados: ${target.name}` : 'Adicionar camada';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 max-lg:p-0">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="layer-upload-title"
        className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-md bg-white shadow-2xl outline-none max-lg:h-[100dvh] max-lg:max-h-none max-lg:rounded-none"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Upload className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          <h2 id="layer-upload-title" className="min-w-0 flex-1 truncate text-[14px] font-semibold text-petrol-900 max-lg:text-[15px]">{title}</h2>
          <button type="button" onClick={onClose} disabled={phase === 'committing'} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px]" aria-label="Fechar">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>

        {!target && phase === 'pick' && (
          <div className="flex gap-1 border-b border-slate-100 px-4 pt-2" role="tablist">
            {[['file', 'Arquivo', FileUp], ['url', 'URL (WMS / XYZ)', Link2]].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px] font-medium max-lg:min-h-11 max-lg:text-[14px] ${tab === id ? 'border-accent-500 text-petrol-900' : 'border-transparent text-slate-500'}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] text-petrol-900 max-lg:text-[14px]">
          {tab === 'url' && !target ? (
            <ExternalForm groupPaths={groupPaths} by={by} onCancel={onClose} onSave={(meta) => { onSavedExternal(meta); onClose(); }} />
          ) : (
            <>
              {(phase === 'pick' || phase === 'error') && (
                <FilePicker onPick={onPickFile} target={target} />
              )}
              {error && (
                <p className="mt-2 flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800" role="alert">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}
              {busy && <Progress progress={progress} />}
              {phase === 'columns' && info?.csv && (
                <ColumnsStep csv={info.csv} onConfirm={(x, y) => reread({ xColumn: x, yColumn: y })} />
              )}
              {phase === 'crs' && (
                <CrsStep info={info} kind={kind} onConfirm={(code) => reread({ crsCode: code })} />
              )}
              {phase === 'preview' && info?.stats && (
                <Preview
                  info={info}
                  kind={kind}
                  file={file}
                  keep={keep}
                  setKeep={setKeep}
                  form={form}
                  setForm={setForm}
                  target={target}
                  mode={mode}
                  setMode={setMode}
                  groupPaths={groupPaths}
                  showRejected={showRejected}
                  setShowRejected={setShowRejected}
                  onChangeCrs={(code) => reread({ crsCode: code })}
                  onChangeShapefile={(layerName) => reread({ layerName })}
                />
              )}
              {phase === 'done' && (
                <p className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800" role="status">
                  <CircleCheck className="h-4 w-4" aria-hidden="true" />
                  Camada salva neste navegador e disponível no painel de camadas.
                </p>
              )}
            </>
          )}
        </div>

        {tab === 'file' || target ? (
          <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 max-lg:flex-wrap max-lg:pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <p className="flex min-w-0 flex-1 items-start gap-1.5 text-[11px] leading-snug text-slate-600 max-lg:text-[12px]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              O arquivo é lido e processado só neste navegador (nada é enviado). A camada fica no IndexedDB deste navegador.
            </p>
            {phase === 'preview' && (
              <button type="button" onClick={commit} className="inline-flex items-center gap-1.5 rounded bg-accent-500 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-600 max-lg:min-h-11 max-lg:w-full max-lg:justify-center max-lg:text-[15px]">
                <CircleCheck className="h-4 w-4" aria-hidden="true" />
                {target ? (mode === 'append' ? 'Anexar como nova versão' : 'Substituir (nova versão)') : `Confirmar e importar ${fmt(info.stats.accepted)} feições`}
              </button>
            )}
            {phase === 'done' && (
              <button type="button" onClick={onClose} className="rounded bg-petrol-800 px-3 py-1.5 text-[13px] font-semibold text-white max-lg:min-h-11 max-lg:w-full">Fechar</button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilePicker({ onPick, target }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const mobile = useIsMobile();
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onPick(e.dataTransfer.files?.[0]); }}
      className={`rounded-md border-2 border-dashed px-4 py-6 text-center ${over ? 'border-accent-400 bg-accent-50' : 'border-slate-300 bg-slate-50'}`}
    >
      <FileUp className="mx-auto h-7 w-7 text-petrol-400" aria-hidden="true" />
      <p className="mt-2 font-semibold">{mobile ? 'Escolha o arquivo da camada' : 'Arraste o arquivo aqui ou escolha no computador'}</p>
      <p className="mt-1 text-[12px] text-slate-600 max-lg:text-[13px]">
        GeoJSON, KML/KMZ, Shapefile (.zip com .shp, .dbf e .prj) ou CSV com latitude/longitude.
        {target ? ' O resultado vira uma nova versão da camada; as anteriores ficam no histórico.' : ''}
      </p>
      <p className="mt-1 text-[11px] text-slate-500 max-lg:text-[12px]">GeoPackage: exporte como Shapefile ou GeoJSON (ainda não aceito diretamente).</p>
      <input ref={inputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 inline-flex items-center gap-1.5 rounded bg-petrol-800 px-3 py-1.5 font-medium text-white hover:bg-petrol-700 max-lg:min-h-11 max-lg:px-4">
        Escolher arquivo
      </button>
    </div>
  );
}

function Progress({ progress }) {
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 font-medium">
        <LoaderCircle className="h-4 w-4 animate-spin text-accent-500" aria-hidden="true" />
        {progress.stage || 'Processando'}…
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded bg-slate-200" aria-hidden="true">
        <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${Math.round((progress.value ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Processamento em segundo plano: o mapa continua utilizável.</p>
    </div>
  );
}

function ColumnsStep({ csv, onConfirm }) {
  const [x, setX] = useState(csv.xColumn >= 0 ? csv.xColumn : '');
  const [y, setY] = useState(csv.yColumn >= 0 ? csv.yColumn : '');
  const sel = (value, set, label) => (
    <label className="block">
      <span className="text-slate-600">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
        <option value="">Escolha a coluna…</option>
        {csv.headers.map((h, i) => <option key={h + i} value={i}>{h || `coluna ${i + 1}`}</option>)}
      </select>
    </label>
  );
  return (
    <div className="space-y-2">
      <p>{fmt(csv.rowCount)} linha(s), codificação {csv.encoding}. Indique as colunas das coordenadas:</p>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {sel(x, setX, 'Longitude (ou Leste/E em UTM)')}
        {sel(y, setY, 'Latitude (ou Norte/N em UTM)')}
      </div>
      <button type="button" disabled={x === '' || y === ''} onClick={() => onConfirm(x, y)} className="rounded bg-petrol-800 px-3 py-1.5 font-medium text-white disabled:opacity-40 max-lg:min-h-11">Continuar</button>
    </div>
  );
}

function CrsSelect({ value, onChange, suggestion }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
      <option value="">Escolha o sistema de referência…</option>
      {KNOWN_CRS.map((c) => <option key={c.code} value={c.code}>{c.name} — {c.code}{c.code === suggestion ? ' (sugerido)' : ''}</option>)}
    </select>
  );
}

function CrsStep({ info, kind, onConfirm }) {
  const suggestion = info?.looksProjected ? 'EPSG:31983' : 'EPSG:4674';
  const [code, setCode] = useState('');
  return (
    <div className="space-y-2">
      <p className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {kind === 'csv'
          ? 'Confirme o sistema de referência das coordenadas do CSV (o CSV não informa isso).'
          : info?.prjDeclared
            ? `O .prj declara "${info.prjDeclared}", que não foi reconhecido. Escolha o referencial correspondente.`
            : 'O arquivo não informa o sistema de referência (falta o .prj). Escolha o referencial usado pela engenharia.'}
      </p>
      {info?.looksProjected && (
        <p className="text-slate-600">As coordenadas estão em metros (projetadas). Dados brasileiros costumam estar em SIRGAS 2000 / UTM; a região de Cataguases fica na zona {utmZoneForLng(-42.7)}S.</p>
      )}
      <label className="block max-w-[460px]">
        <span className="text-slate-600">Sistema de referência</span>
        <CrsSelect value={code} onChange={setCode} suggestion={suggestion} />
      </label>
      <button type="button" disabled={!code} onClick={() => onConfirm(code)} className="rounded bg-petrol-800 px-3 py-1.5 font-medium text-white disabled:opacity-40 max-lg:min-h-11">Reprojetar e pré-visualizar</button>
    </div>
  );
}

function Preview({
  info, kind, file, keep, setKeep, form, setForm, target, mode, setMode, groupPaths, showRejected, setShowRejected, onChangeCrs, onChangeShapefile,
}) {
  const { stats } = info;
  const bounds = stats.bbox ? bboxToBounds(stats.bbox) : null;
  const sampleKey = `${stats.accepted}|${stats.bbox?.join(',')}`;
  const sample = useMemo(() => ({ type: 'FeatureCollection', features: info.sample }), [info.sample]);
  const famText = Object.entries(stats.families).filter(([, n]) => n).map(([k, n]) => `${fmt(n)} ${FAMILY_LABEL[k]}`).join(', ');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const fam = stats.geometryType;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-lg:grid-cols-1">
      <div className="space-y-3">
        <section>
          <h3 className="font-semibold">Resumo</h3>
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] max-lg:text-[14px]">
            <dt className="text-slate-500">Arquivo</dt><dd className="truncate">{file?.name} ({KIND_LABEL[kind]}{file ? `, ${mb(file.size)}` : ''})</dd>
            <dt className="text-slate-500">Feições</dt><dd>{fmt(stats.accepted)} aceitas de {fmt(stats.total)}{famText ? ` — ${famText}` : ''}</dd>
            <dt className="text-slate-500">Corrigidas</dt><dd>{fmt(stats.fixed)}</dd>
            <dt className="text-slate-500">Rejeitadas</dt>
            <dd className={info.rejectedTotal ? 'font-medium text-red-700' : ''}>
              {fmt(info.rejectedTotal)}
              {info.rejectedTotal > 0 && (
                <>
                  {' '}
                  <button type="button" className="underline" onClick={() => setShowRejected((v) => !v)}>{showRejected ? 'ocultar relatório' : 'ver relatório'}</button>
                  {' · '}
                  <button type="button" className="inline-flex items-center gap-0.5 underline" onClick={() => downloadCsv('feicoes_rejeitadas.csv', info.rejected)}><Download className="h-3 w-3" aria-hidden="true" />CSV</button>
                </>
              )}
            </dd>
            <dt className="text-slate-500">Referencial</dt>
            <dd>
              {info.crs?.name ?? '—'}
              {info.crs?.source === 'prj' && ' (lido do .prj)'}
              {info.crs?.source === 'rfc7946' && ' (padrão do GeoJSON)'}
              {info.crs?.source === 'usuario' && ' (escolhido)'}
              {' → WGS 84 (EPSG:4326)'}
            </dd>
          </dl>
          {kind !== 'kml' && kind !== 'kmz' && (
            <details className="mt-1 text-[12px]">
              <summary className="cursor-pointer text-petrol-700">Alterar o referencial de origem</summary>
              <div className="mt-1 max-w-[420px]"><CrsSelect value={info.crs?.code ?? ''} onChange={(c) => c && onChangeCrs(c)} /></div>
            </details>
          )}
          {info.shapefiles?.length > 1 && (
            <label className="mt-1 block max-w-[420px] text-[12px]">
              <span className="text-slate-600">O .zip tem {info.shapefiles.length} shapefiles. Importar:</span>
              <select value={info.shapefiles.find((s) => s.endsWith(info.layerName)) ?? ''} onChange={(e) => onChangeShapefile(e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
                {info.shapefiles.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {showRejected && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-red-100 bg-red-50/50 px-2 py-1 text-[12px]">
              {info.rejected.map((r) => <li key={r.index}>{r.ref}: {r.reason}</li>)}
              {info.rejectedTotal > info.rejected.length && <li>… e mais {fmt(info.rejectedTotal - info.rejected.length)}</li>}
            </ul>
          )}
          {stats.accepted > DATA_LAYER_LIMITS.warnFeatures && (
            <p className="mt-1 text-amber-800">Camada muito grande para o navegador: o desempenho depende da memória deste computador.</p>
          )}
        </section>

        <section>
          <h3 className="font-semibold">Atributos ({info.attributes.length}) — escolha quais manter</h3>
          <div className="mt-1 max-h-52 overflow-auto rounded border border-slate-200">
            <table className="w-full text-left text-[12px] max-lg:text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr><th className="px-2 py-1"><span className="sr-only">Manter</span></th><th className="px-2 py-1">Campo</th><th className="px-2 py-1">Tipo</th><th className="px-2 py-1">Exemplos</th></tr>
              </thead>
              <tbody>
                {info.attributes.map((a) => (
                  <tr key={a.name} className="border-t border-slate-100">
                    <td className="px-2 py-1"><input type="checkbox" checked={!!keep[a.name]} onChange={() => setKeep((k) => ({ ...k, [a.name]: !k[a.name] }))} aria-label={`Manter ${a.name}`} className="accent-accent-500 max-lg:h-5 max-lg:w-5" /></td>
                    <td className="px-2 py-1 font-medium">{a.name}</td>
                    <td className="px-2 py-1 text-slate-500">{a.type}{a.filledRatio < 1 ? ` (${Math.round(a.filledRatio * 100)}%)` : ''}</td>
                    <td className="max-w-[220px] truncate px-2 py-1 text-slate-600">{a.samples.join(' · ')}</td>
                  </tr>
                ))}
                {!info.attributes.length && <tr><td colSpan={4} className="px-2 py-2 text-slate-500">Sem atributos.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">
          {target ? (
            <fieldset className="col-span-2 max-sm:col-span-1">
              <legend className="font-semibold">Como atualizar</legend>
              {[['replace', `Substituir: a nova versão tem só as ${fmt(stats.accepted)} feições deste arquivo`], ['append', `Anexar: a nova versão soma as ${fmt(target.metadata?.featureCount)} atuais e as ${fmt(stats.accepted)} deste arquivo`]].map(([v, label]) => (
                <label key={v} className="mt-1 flex items-start gap-2 max-lg:min-h-11">
                  <input type="radio" name="update-mode" checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 accent-accent-500 max-lg:h-5 max-lg:w-5" />
                  {label}
                </label>
              ))}
              <p className="mt-1 text-[12px] text-slate-500">A versão atual (v{target.currentVersion}) continua no histórico.</p>
            </fieldset>
          ) : (
            <>
              <label className="col-span-2 block max-sm:col-span-1">
                <span className="text-slate-600">Nome da camada *</span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
              </label>
              <label className="col-span-2 block max-sm:col-span-1">
                <span className="text-slate-600">Descrição</span>
                <input value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
              </label>
              <label className="block">
                <span className="text-slate-600">Grupo (use › para pastas)</span>
                <input list="layer-group-paths" value={form.group} onChange={(e) => set('group', e.target.value.replace(/›/g, '>'))} placeholder="Ex.: Energisa > Rede Elétrica" className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
                <datalist id="layer-group-paths">{groupPaths.map((p) => <option key={p} value={p} />)}</datalist>
              </label>
              <label className="block">
                <span className="text-slate-600">Visibilidade</span>
                <select value={form.visibility} onChange={(e) => set('visibility', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
                  {Object.entries(VISIBILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <div className="col-span-2 flex flex-wrap items-end gap-3 max-sm:col-span-1">
                <label className="block">
                  <span className="text-slate-600">Cor</span>
                  <span className="mt-0.5 flex gap-1">
                    {CATEGORY_PALETTE.slice(0, 8).map((c) => (
                      <button key={c} type="button" onClick={() => set('color', c)} aria-label={`Cor ${c}`} aria-pressed={form.color === c} className={`h-6 w-6 rounded-full border-2 max-lg:h-9 max-lg:w-9 ${form.color === c ? 'border-petrol-900' : 'border-white'}`} style={{ background: c }} />
                    ))}
                  </span>
                </label>
                {(fam === 'point' || fam === 'mixed') && (
                  <label className="block">
                    <span className="text-slate-600">Símbolo</span>
                    <select value={form.symbol} onChange={(e) => set('symbol', e.target.value)} className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
                      {Object.entries(SYMBOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                )}
                <label className="block">
                  <span className="text-slate-600">{fam === 'point' ? 'Tamanho' : 'Espessura'}</span>
                  <input type="number" min="1" max="12" step="0.5" value={fam === 'point' ? form.radius : form.weight} onChange={(e) => set(fam === 'point' ? 'radius' : 'weight', Number(e.target.value))} className="mt-0.5 block w-20 rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
                </label>
                <label className="block">
                  <span className="text-slate-600">Zoom mínimo</span>
                  <input type="number" min="0" max="18" value={form.minZoom} placeholder="—" onChange={(e) => set('minZoom', e.target.value)} className="mt-0.5 block w-20 rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
                </label>
              </div>
              <p className="col-span-2 text-[12px] text-slate-500 max-sm:col-span-1">O estilo por atributo (ex.: cor da linha por tensão) é definido depois, em “Configurar” no painel de camadas.</p>
            </>
          )}
        </section>
      </div>

      <div>
        <h3 className="font-semibold">Extensão no mapa</h3>
        <p className="text-[11px] text-slate-500">Amostra de até 1.500 feições.</p>
        <div className="relative mt-1 h-[300px] overflow-hidden rounded border border-slate-200 max-lg:h-[240px]">
          {bounds && (
            <MapContainer key={sampleKey} bounds={bounds} boundsOptions={{ padding: [16, 16] }} zoomControl={false} attributionControl={false} preferCanvas className="absolute inset-0 h-full w-full">
              <TileLayer url={BASEMAPS[0].url} className={BASEMAPS[0].className} />
              <Rectangle bounds={bounds} pathOptions={{ color: '#EE7A12', weight: 1.5, fill: false, dashArray: '4 4' }} />
              <GeoJSON
                data={sample}
                style={() => ({ color: form.color ?? '#2563EB', weight: 1.5, fillOpacity: 0.2 })}
                pointToLayer={(_, latlng) => L.circleMarker(latlng, {
                  radius: 3, color: '#fff', weight: 0.8, fillColor: form.color ?? '#2563EB', fillOpacity: 1,
                })}
              />
            </MapContainer>
          )}
        </div>
      </div>
    </div>
  );
}

const URL_RE = /^https:\/\/[^\s]+$/i;

function ExternalForm({
  groupPaths, onCancel, onSave,
}) {
  const [f, setF] = useState({
    type: 'xyz', url: '', layers: '', format: 'image/png', name: '', attribution: '', group: groupPaths[0] ?? '',
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const problems = [];
  if (f.name.trim().length < 2) problems.push('Informe o nome da camada.');
  if (!URL_RE.test(f.url.trim())) problems.push('A URL deve começar com https://.');
  if (f.type === 'xyz' && !/\{z\}/.test(f.url) && f.url) problems.push('A URL XYZ precisa conter {z}, {x} e {y}.');
  if (f.type === 'wms' && !f.layers.trim()) problems.push('Informe o nome da(s) camada(s) WMS (parâmetro LAYERS).');
  return (
    <div className="space-y-2">
      <p className="flex gap-2 rounded border border-petrol-100 bg-petrol-50 px-3 py-2 text-petrol-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        WMS e XYZ são imagens e funcionam com a política de segurança atual. WFS e vector tiles por URL exigem baixar dados de outro domínio, o que a CSP (connect-src &apos;self&apos;) bloqueia; ficam para quando houver backend.
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">
        <label className="block">
          <span className="text-slate-600">Tipo</span>
          <select value={f.type} onChange={(e) => set('type', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
            <option value="xyz">XYZ (tiles {'{z}/{x}/{y}'})</option>
            <option value="wms">WMS</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Nome *</span>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
        </label>
        <label className="col-span-2 block max-sm:col-span-1">
          <span className="text-slate-600">URL *</span>
          <input value={f.url} onChange={(e) => set('url', e.target.value)} placeholder={f.type === 'xyz' ? 'https://servidor/tiles/{z}/{x}/{y}.png' : 'https://servidor/geoserver/wms'} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[12px] max-lg:min-h-11" />
        </label>
        {f.type === 'wms' && (
          <label className="block">
            <span className="text-slate-600">Camada(s) WMS *</span>
            <input value={f.layers} onChange={(e) => set('layers', e.target.value)} placeholder="workspace:camada" className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
          </label>
        )}
        <label className="block">
          <span className="text-slate-600">Grupo</span>
          <input list="layer-group-paths-ext" value={f.group} onChange={(e) => set('group', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
          <datalist id="layer-group-paths-ext">{groupPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="col-span-2 block max-sm:col-span-1">
          <span className="text-slate-600">Atribuição (fonte)</span>
          <input value={f.attribution} onChange={(e) => set('attribution', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" />
        </label>
      </div>
      {problems.length > 0 && f.url && <p className="text-amber-800">{problems[0]}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={problems.length > 0} onClick={() => onSave({ ...f, url: f.url.trim(), name: f.name.trim() })} className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-white disabled:opacity-40 max-lg:min-h-11">Adicionar camada</button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 max-lg:min-h-11">Cancelar</button>
      </div>
    </div>
  );
}
