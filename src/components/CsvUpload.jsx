import { useRef, useState } from 'react';
import {
  FileSpreadsheet, Upload, LoaderCircle, CircleCheck, CircleAlert, Info, RotateCcw, X, Play,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { PROCESSING_STEPS } from '../config.js';

/** Rótulo e tom de cada estado do arquivo. */
const FILE_STATUS = {
  queued: { label: 'Na fila', tone: 'neutral' },
  validating: { label: 'Validando', tone: 'progress' },
  validated: { label: 'Validado', tone: 'success' },
  warning: { label: 'Validado com alertas', tone: 'warning' },
  invalid: { label: 'Com problemas', tone: 'danger' },
  processed: { label: 'Processamento concluído', tone: 'success' },
};

export default function CsvUpload({
  file, phase, stepIndex, errorMessage, onSelectFile, onUseDemo, onProcess, onCancel, onReset,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const status = FILE_STATUS[file.status];
  const processing = phase === 'processing';
  const done = phase === 'done';
  const canProcess = !processing && !done && file.status !== 'invalid' && file.status !== 'validating';

  const handleFiles = (files) => {
    const f = files?.[0];
    if (f) onSelectFile(f);
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="upload-title">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <h2 id="upload-title" className="flex items-center gap-2 text-[13.5px] font-semibold text-petrol-900">
          <FileSpreadsheet className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          Importação de pontos
        </h2>
      </div>

      <div className="space-y-3 p-3.5">
        {/* Área de arrastar e soltar */}
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
          <p className="mt-1 text-[12.5px] text-slate-600">Arraste o arquivo da engenharia ou clique para procurar</p>
          <button
            type="button"
            disabled={processing}
            onClick={() => inputRef.current?.click()}
            className="mt-2 rounded border border-petrol-200 bg-white px-3 py-1 text-[12.5px] font-medium text-petrol-700 hover:border-petrol-400 disabled:cursor-not-allowed"
          >
            Selecionar arquivo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Selecionar arquivo CSV"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {/* Arquivo atual */}
        <div className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-petrol-900" title={file.name}>{file.name}</p>
            <p className="text-[11.5px] text-slate-500">
              {file.source === 'demo' ? 'Arquivo demonstrativo' : 'Arquivo selecionado'}
              {file.records != null && ` | ${file.records} registros`}
            </p>
            <StatusBadge tone={status.tone} className="mt-1">{status.label}</StatusBadge>
          </div>
        </div>

        {/* Resultado da validação de um arquivo real */}
        {file.source === 'user' && file.validation && (
          <div
            className={`rounded-md border px-3 py-2 text-[12px] ${
              file.status === 'invalid' ? 'border-red-200 bg-red-50 text-red-800'
                : file.status === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {file.status === 'invalid' ? <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                : <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              {file.validation.valid} de {file.validation.total} registros com coordenadas válidas
            </p>
            {file.validation.problems.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {file.validation.problems.slice(0, 3).map((p) => <li key={p}>{p}</li>)}
                {file.validation.problems.length > 3 && <li>e mais {file.validation.problems.length - 3} ocorrência(s).</li>}
              </ul>
            )}
          </div>
        )}

        {file.source === 'user' && (
          <div className="flex gap-2 rounded-md bg-petrol-50 px-3 py-2 text-[11.5px] leading-snug text-petrol-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>
              O arquivo foi apenas validado no navegador. A simulação usa os 100 pontos demonstrativos; as coordenadas
              deste arquivo não são cruzadas com nenhuma malha.{' '}
              {!processing && (
                <button type="button" onClick={onUseDemo} className="font-medium underline underline-offset-2 hover:text-petrol-600">
                  Usar arquivo demonstrativo
                </button>
              )}
            </p>
          </div>
        )}

        {/* Processamento */}
        {processing && (
          <div className="rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5" role="status" aria-live="polite">
            <ol className="space-y-1.5">
              {PROCESSING_STEPS.map((s, i) => (
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

        {phase === 'idle' && file.status !== 'invalid' && (
          <p className="text-[12px] leading-snug text-slate-600">
            Clique em <strong className="font-semibold text-petrol-800">Processar Coordenadas</strong> para iniciar a análise territorial.
          </p>
        )}

        {/* Ações */}
        <div className="flex gap-2">
          {!done && !processing && (
            <button
              type="button"
              onClick={onProcess}
              disabled={!canProcess}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent-500 px-3 py-2 text-[13.5px] font-semibold text-white shadow-sm hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Processar Coordenadas
            </button>
          )}
          {processing && (
            <>
              <button
                type="button"
                disabled
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent-400 px-3 py-2 text-[13.5px] font-semibold text-white"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                Processando…
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Cancelar
              </button>
            </>
          )}
          {done && (
            <button
              type="button"
              onClick={onReset}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-petrol-200 bg-white px-3 py-2 text-[13px] font-medium text-petrol-700 hover:border-petrol-400"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reiniciar demonstração
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
