import { useRef, useState } from 'react';
import {
  FileSpreadsheet, Upload, LoaderCircle, CircleCheck, CircleAlert, Info, RotateCcw, Play, ShieldCheck, ListChecks, TriangleAlert,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { MAPPABLE_FIELDS, CRS_OPTIONS, isProcessableCrs } from '../lib/csv.js';
import { REAL_PROCESSING_STEPS } from '../config.js';

const DELIMITER_LABEL = { ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'tabulação' };

const STATUS = {
  empty: { label: 'Nenhum arquivo', tone: 'neutral' },
  reading: { label: 'Lendo arquivo', tone: 'progress' },
  parsed: { label: 'Aguardando validação', tone: 'info' },
  validated: { label: 'Validado', tone: 'success' },
  warning: { label: 'Validado com alertas', tone: 'warning' },
  invalid: { label: 'Com problemas', tone: 'danger' },
  error: { label: 'Não interpretado', tone: 'danger' },
};

function importStatus(imp) {
  if (imp.status !== 'validated') return imp.status;
  const v = imp.validation;
  if (!v.ok) return 'invalid';
  return v.invalid || v.warnings ? 'warning' : 'validated';
}

/**
 * Importação real: seleção do CSV, prévia, mapeamento de colunas,
 * declaração do referencial, validação e processamento.
 * Tudo acontece no navegador; nada é enviado.
 */
export default function RealImportPanel({
  imp, layerState, phase, stepIndex, errorMessage, title = 'Importação de pontos', accent = false,
  onSelectFile, onMappingChange, onCrsChange, onValidate, onProcess, onReset, onOpenAudit,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const processing = phase === 'processing';
  const done = phase === 'done';
  const statusKey = importStatus(imp);
  const status = STATUS[statusKey];
  const hasFile = imp.status !== 'empty' && imp.status !== 'reading';
  const parsed = imp.parsed;
  const v = imp.validation;

  const layerReady = layerState.status === 'loaded';
  const crsOk = isProcessableCrs(imp.crs);
  const blockers = [
    !layerReady && 'camada territorial oficial carregada',
    !crsOk && 'referencial das coordenadas declarado (graus decimais WGS84 ou SIRGAS 2000)',
    !(v?.ok) && 'arquivo validado com ao menos um registro válido',
  ].filter(Boolean);
  const canProcess = !processing && !done && blockers.length === 0;

  const handleFiles = (files) => {
    const f = files?.[0];
    if (f) onSelectFile(f);
  };

  const errorRecords = v ? v.records.filter((r) => r.issues.length) : [];

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="upload-title">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <h2 id="upload-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-petrol-900">
          <FileSpreadsheet className={`h-4 w-4 ${accent ? 'text-red-600' : 'text-petrol-500'}`} aria-hidden="true" />
          {title}
        </h2>
        <StatusBadge tone="info">Dados reais</StatusBadge>
      </div>

      <div className="space-y-3 p-3.5">
        {!done && (
          <div
            onDragOver={(e) => { e.preventDefault(); if (!processing) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!processing) handleFiles(e.dataTransfer.files);
            }}
            className={`rounded-md border border-dashed px-3 py-3 text-center transition-colors ${
              dragging ? 'border-accent-500 bg-accent-50' : 'border-slate-300 bg-slate-50'
            } ${processing ? 'opacity-60' : ''}`}
          >
            <Upload className="mx-auto h-5 w-5 text-petrol-400" aria-hidden="true" />
            <p className="mt-1 text-[12.5px] text-slate-600 max-lg:hidden">Arraste o CSV da engenharia ou clique para procurar</p>
            <p className="mt-1 text-[14px] text-slate-600 lg:hidden">Escolha o arquivo CSV da engenharia</p>
            <button
              type="button"
              disabled={processing}
              onClick={() => inputRef.current?.click()}
              className="mt-2 rounded border border-petrol-200 bg-white px-3 py-1 text-[12.5px] font-medium text-petrol-700 hover:border-petrol-400 disabled:cursor-not-allowed max-lg:min-h-12 max-lg:w-full max-lg:text-[15px]"
            >
              <span className="max-lg:hidden">Selecionar arquivo</span>
              <span className="lg:hidden">Escolher arquivo CSV</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Selecionar arquivo CSV"
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-slate-500">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Lido somente neste navegador. Não é enviado nem salvo.
            </p>
          </div>
        )}

        {imp.status !== 'empty' && (
          <div className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-petrol-900" title={imp.fileName}>{imp.fileName}</p>
              {parsed && (
                <p className="text-[11.5px] text-slate-500">
                  {parsed.rowCount} registro(s) | {parsed.headers.length} coluna(s) | {DELIMITER_LABEL[parsed.delimiter]} | {imp.encoding}
                </p>
              )}
              <StatusBadge tone={status.tone} className="mt-1">{status.label}</StatusBadge>
            </div>
          </div>
        )}

        {imp.status === 'error' && (
          <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>{imp.error}</p>
          </div>
        )}

        {/* Prévia */}
        {hasFile && parsed?.headers.length > 0 && !done && (
          <details className="rounded-md border border-slate-200 text-[11.5px]" open={imp.status === 'parsed'}>
            <summary className="cursor-pointer px-3 py-1.5 font-medium text-petrol-800 max-lg:flex max-lg:min-h-11 max-lg:items-center max-lg:text-[14px]">Prévia (primeiras {parsed.preview.length} linhas)</summary>
            <div className="max-h-40 overflow-auto border-t border-slate-100">
              <table className="min-w-full text-left">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>{parsed.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1 font-semibold text-slate-600">{h || `(coluna ${i + 1})`}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.preview.map((row, r) => (
                    <tr key={r} className="border-t border-slate-100">
                      {parsed.headers.map((_, c) => <td key={c} className="whitespace-nowrap px-2 py-1 text-slate-700">{row[c]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Mapeamento e referencial */}
        {hasFile && parsed?.headers.length > 0 && !done && (
          <fieldset className="space-y-1.5 rounded-md border border-slate-200 px-3 py-2.5" disabled={processing}>
            <legend className="px-1 text-[12px] font-semibold text-petrol-900">Mapeamento das colunas</legend>
            {MAPPABLE_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[118px_1fr] items-center gap-2 text-[11.5px] text-slate-600 max-lg:grid-cols-[104px_minmax(0,1fr)] max-lg:text-[13px]">
                <span>{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                <select
                  value={imp.mapping[f.key] ?? ''}
                  onChange={(e) => onMappingChange(f.key, e.target.value === '' ? null : Number(e.target.value))}
                  className="min-w-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] text-petrol-900 max-lg:min-h-11"
                >
                  <option value="">{f.required ? 'Selecione…' : 'Não disponível'}</option>
                  {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                </select>
              </label>
            ))}
            <label className="grid grid-cols-[118px_1fr] items-center gap-2 pt-1 text-[11.5px] text-slate-600 max-lg:grid-cols-[104px_minmax(0,1fr)] max-lg:text-[13px]">
              <span>Referencial<span className="text-red-600"> *</span></span>
              <select
                value={imp.crs}
                onChange={(e) => onCrsChange(e.target.value)}
                className="min-w-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] text-petrol-900 max-lg:min-h-11"
              >
                {CRS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {imp.crs && !crsOk && (
              <p className="flex gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                Confirme com a engenharia o referencial de origem. Coordenadas projetadas (UTM) ou de referencial desconhecido não
                são convertidas nesta versão e não podem ser processadas.
              </p>
            )}
            <p className="text-[11px] leading-snug text-slate-500">
              A sugestão automática usa só os nomes dos cabeçalhos. Confira antes de validar.
            </p>
            <button
              type="button"
              onClick={onValidate}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-petrol-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-petrol-800 hover:border-petrol-500 max-lg:min-h-12 max-lg:text-[15px]"
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
              Validar registros
            </button>
          </fieldset>
        )}

        {/* Relatório de validação */}
        {v && (
          <div
            className={`rounded-md border px-3 py-2 text-[12px] ${
              statusKey === 'invalid' ? 'border-red-200 bg-red-50 text-red-800'
                : statusKey === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {statusKey === 'invalid' ? <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              {v.total} importado(s) | {v.valid} válido(s) | {v.invalid} inválido(s)
            </p>
            {v.warnings > 0 && <p className="mt-0.5">{v.warnings} registro(s) válido(s) com alerta para revisão.</p>}
            {v.fileProblems.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{v.fileProblems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            {errorRecords.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer font-medium max-lg:flex max-lg:min-h-11 max-lg:items-center">Ver ocorrências ({errorRecords.length})</summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-1">
                  {errorRecords.map((r) => (
                    <li key={r.line}>
                      <span className="font-semibold">Linha {r.line}{r.id ? ` (${r.id})` : ''}:</span>{' '}
                      {r.issues.map((x) => `${x.severity === 'error' ? '' : 'alerta: '}${x.message}`).join(' ')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Processamento */}
        {processing && (
          <div className="rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5" role="status" aria-live="polite">
            <ol className="space-y-1.5">
              {REAL_PROCESSING_STEPS.map((s, i) => (
                <li key={s.id} className={`flex items-center gap-2 text-[12px] ${i <= stepIndex ? 'text-petrol-900' : 'text-slate-400'}`}>
                  {i < stepIndex && <CircleCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />}
                  {i === stepIndex && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent-600" aria-hidden="true" />}
                  {i > stepIndex && <span className="h-3.5 w-3.5 rounded-full border border-slate-300" aria-hidden="true" />}
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
        )}

        {!done && !processing && hasFile && blockers.length > 0 && (
          <div className="flex gap-2 rounded-md bg-petrol-50 px-3 py-2 text-[11.5px] leading-snug text-petrol-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>Para processar, é necessário: {blockers.join('; ')}.</p>
          </div>
        )}

        <div className="flex gap-2 max-lg:sticky max-lg:-bottom-3 max-lg:z-10 max-lg:-mx-3.5 max-lg:-mb-3.5 max-lg:rounded-b-md max-lg:border-t max-lg:border-slate-200 max-lg:bg-white max-lg:px-3.5 max-lg:py-2.5">
          {!done && !processing && (
            <button
              type="button"
              onClick={onProcess}
              disabled={!canProcess}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent-500 px-3 py-2 text-[13.5px] font-semibold text-white shadow-sm max-lg:min-h-12 max-lg:text-[15px] hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Processar Coordenadas
            </button>
          )}
          {processing && (
            <button type="button" disabled className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent-400 px-3 py-2 text-[13.5px] font-semibold text-white max-lg:min-h-12 max-lg:text-[15px]">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              Processando…
            </button>
          )}
          {done && (
            <>
              <button
                type="button"
                onClick={onOpenAudit}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-petrol-700 px-3 py-2 text-[13px] font-semibold text-white hover:bg-petrol-800 max-lg:min-h-12 max-lg:text-[15px]"
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Auditoria
              </button>
              <button
                type="button"
                onClick={onReset}
                className="flex items-center justify-center gap-2 rounded-md border border-petrol-200 bg-white px-3 py-2 text-[13px] font-medium text-petrol-700 hover:border-petrol-400 max-lg:min-h-12 max-lg:text-[15px]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Novo arquivo
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
