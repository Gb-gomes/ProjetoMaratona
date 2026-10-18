import { useEffect, useRef, useState } from 'react';
import {
  X, Users, FileUp, LoaderCircle, Download, Upload, Info, CircleCheck, TriangleAlert,
} from 'lucide-react';
import StatusBadge from '../StatusBadge.jsx';

const fmt = (n) => Number(n ?? 0).toLocaleString('pt-BR');

function Section({ title, children }) {
  return (
    <section className="space-y-2 rounded border border-slate-200 px-3 py-2.5">
      <h3 className="font-semibold text-petrol-900">{title}</h3>
      {children}
    </section>
  );
}

function ListBlock({ title, items, render, tone = 'neutral' }) {
  if (!items?.length) return null;
  return (
    <details className="text-[12px] max-lg:text-[13px]">
      <summary className="cursor-pointer max-lg:min-h-11 max-lg:py-2">
        <StatusBadge tone={tone}>{fmt(items.length)}</StatusBadge>
        {' '}
        {title}
      </summary>
      <ul className="ml-4 mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-3 text-slate-700">
        {items.map((it, i) => <li key={i}>{render(it)}</li>) /* eslint-disable-line react/no-array-index-key */}
      </ul>
    </details>
  );
}

/** Relatório de uma importação de comunidades. */
export function ImportReport({ report }) {
  if (!report) return null;
  const stats = [
    ['Importadas (novas)', report.created.length, 'success'],
    ['Atualizadas', report.updated.length, 'info'],
    ['Sem alteração', report.unchanged.length, 'neutral'],
    ['Ignoradas', report.skipped.length, report.skipped.length ? 'warning' : 'neutral'],
    ['Inválidas', report.invalid.length, report.invalid.length ? 'danger' : 'neutral'],
  ];
  return (
    <div className="space-y-2" role="status">
      <p className="text-slate-600">
        {report.municipio} ({report.codMun}) · {report.fileName} · {new Date(report.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {report.by}
      </p>
      <div className="grid grid-cols-5 gap-1.5 max-sm:grid-cols-3">
        {stats.map(([label, n, tone]) => (
          <div key={label} className="rounded border border-slate-200 px-2 py-1">
            <p className="text-[16px] font-semibold"><StatusBadge tone={tone}>{fmt(n)}</StatusBadge></p>
            <p className="text-[11px] leading-tight text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      <ListBlock title="avisos de contenção (passaram mais de 50 m da borda do município; a parte de fora foi recortada)" tone="warning" items={report.containment} render={(c) => `${c.name} (${c.id}): até ${fmt(c.maxOutsideMeters)} m fora; ${fmt(c.clippedM2)} m² recortados`} />
      <ListBlock title="sobreposições resolvidas (a área fica com a de confiança boa; em empate, com a menor)" tone="info" items={report.overlaps} render={(o) => `${o.a} × ${o.b}: ${o.areaM2.toLocaleString('pt-BR')} m² → ${o.winner}`} />
      <ListBlock title="com confiança baixa (aparecem como localização aproximada)" tone="warning" items={report.lowConfidence} render={(c) => `${c.name} (${c.id})`} />
      <ListBlock title="com edições manuais preservadas" tone="info" items={report.preserved} render={(p) => `${p.name} (${p.id}): ${p.fields.join(' e ')}`} />
      <ListBlock title="ignoradas" tone="warning" items={report.skipped} render={(s) => `${s.id}: ${s.reason}`} />
      <ListBlock title="inválidas" tone="danger" items={report.invalid} render={(s) => `${s.ref}: ${s.reason}`} />
      <ListBlock title="no sistema, mas ausentes do arquivo (mantidas)" items={report.missing} render={(m) => `${m.name} (${m.id})`} />
      <ListBlock title="sobreposição com comunidades criadas no sistema" tone="warning" items={report.overlapWarnings} render={(o) => `${o.id} × ${o.with}: ${fmt(o.areaM2)} m²`} />
      <ListBlock title="avisos" tone="warning" items={report.warnings} render={(w) => w} />
    </div>
  );
}

/**
 * Comunidades: importação dos arquivos microrregioes_<COD_IBGE_MUN>.geojson,
 * relatório e correção dos nomes de exibição em lote.
 */
export default function CommunitiesDialog({
  open, onClose, manifest, countsByMun, canManage, operator, operatorLocked,
  onImport, onApplyNames, onExportNames, lastReport,
}) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const namesRef = useRef(null);
  const [by, setBy] = useState(operator ?? '');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [namesReport, setNamesReport] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setBy((b) => b || operator || '');
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, operator]);
  if (!open) return null;
  const who = operatorLocked ? operator : by;

  const run = async (label, fn) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const importJson = (gj, fileName) => run(fileName, () => onImport({
    gj, fileName, overwriteEdits: overwrite, by: who,
  }));

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 max-lg:p-0">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="communities-title" className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-md bg-white shadow-2xl outline-none max-lg:h-[100dvh] max-lg:max-h-none max-lg:rounded-none">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Users className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          <h2 id="communities-title" className="flex-1 text-[14px] font-semibold text-petrol-900 max-lg:text-[15px]">Comunidades</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px]" aria-label="Fechar">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] text-petrol-900 max-lg:text-[14px]">
          <p className="flex gap-2 rounded border border-petrol-100 bg-petrol-50 px-3 py-2 text-petrol-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              As comunidades dão o nome do lugar abaixo do distrito: <b>UF › Município › Distrito (IBGE) › Comunidade</b>.
              Os limites do IBGE não mudam. Os contornos das comunidades são aproximados e podem ser ajustados.
            </span>
          </p>

          {!canManage && <p className="rounded bg-slate-50 px-2 py-1 text-slate-600">Importar e editar comunidades é permitido só a administradores.</p>}

          <fieldset disabled={!canManage || !!busy} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-[220px] flex-1">
                <span className="text-slate-600">Responsável *</span>
                <input value={who} readOnly={operatorLocked} onChange={(e) => setBy(e.target.value)} placeholder="Nome ou matrícula" className={`mt-0.5 block w-full rounded border px-2 py-1 max-lg:min-h-11 ${operatorLocked ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white'}`} autoComplete="off" />
              </label>
              <label className="flex items-center gap-2 max-lg:min-h-11" title="Normalmente, nomes e contornos editados no sistema são mantidos ao reimportar.">
                <input type="checkbox" checked={overwrite} onChange={() => setOverwrite((v) => !v)} className="accent-accent-500 max-lg:h-5 max-lg:w-5" />
                Sobrescrever edições manuais (nome e contorno)
              </label>
            </div>

            <Section title="Arquivos do projeto">
              <ul className="divide-y divide-slate-100">
                {(manifest?.arquivos ?? []).map((f) => (
                  <li key={f.arquivo} className="flex items-center gap-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{f.municipio}/{f.uf} <span className="font-mono text-[11px] text-slate-500">{f.codIbgeMun}</span></p>
                      <p className="text-[12px] text-slate-500">{f.arquivo} · {fmt(f.comunidades)} comunidades · no sistema: {fmt(countsByMun[f.codIbgeMun] ?? 0)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => run(f.arquivo, async () => {
                        const res = await fetch(`${manifest.baseUrl}${f.arquivo}`, { cache: 'no-cache' });
                        if (!res.ok) throw new Error(`Arquivo ${f.arquivo} não encontrado.`);
                        await onImport({ gj: await res.json(), fileName: f.arquivo, overwriteEdits: overwrite, by: who });
                      })}
                      className="inline-flex items-center gap-1 rounded bg-petrol-800 px-2.5 py-1 font-medium text-white hover:bg-petrol-700 disabled:opacity-40 max-lg:min-h-11"
                    >
                      {busy === f.arquivo ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                      {countsByMun[f.codIbgeMun] ? 'Reimportar' : 'Importar'}
                    </button>
                  </li>
                ))}
                {!manifest?.arquivos?.length && <li className="py-1.5 text-slate-500">Nenhum arquivo listado em public/data/comunidades/index.json.</li>}
              </ul>
              <div>
                <input ref={fileRef} type="file" accept=".geojson,.json" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  let gj;
                  try { gj = JSON.parse(await f.text()); } catch { setError('O arquivo não é um JSON válido.'); return; }
                  importJson(gj, f.name);
                }}
                />
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1 font-medium hover:bg-slate-50 max-lg:min-h-11">
                  <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Importar outro arquivo (microrregioes_&lt;COD_IBGE_MUN&gt;.geojson)
                </button>
              </div>
            </Section>

            <Section title="Nomes de exibição">
              <p className="text-slate-600">
                O arquivo traz os nomes sem acento (&quot;Sao Diniz&quot;). Corrija um a um em <b>Sub-regiões › Comunidades › Renomear</b>, ou em lote
                com uma planilha <span className="font-mono text-[12px]">COD_IBGE_MUN;ID;nome_exibicao</span>. O ID não muda.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onExportNames(null)} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1 font-medium hover:bg-slate-50 max-lg:min-h-11">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Baixar planilha com os nomes atuais
                </button>
                <input ref={namesRef} type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  run(f.name, async () => setNamesReport(await onApplyNames(await f.text(), who)));
                }}
                />
                <button type="button" onClick={() => namesRef.current?.click()} className="inline-flex items-center gap-1.5 rounded bg-petrol-800 px-2.5 py-1 font-medium text-white hover:bg-petrol-700 max-lg:min-h-11">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Importar planilha de nomes
                </button>
              </div>
              {namesReport && (
                <div className="text-[12px]" role="status">
                  <p className="flex items-center gap-1.5 text-emerald-800"><CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />{fmt(namesReport.changed.length)} nome(s) corrigido(s); {fmt(namesReport.unchanged.length)} já estavam iguais.</p>
                  <ListBlock title="não encontradas" tone="warning" items={namesReport.notFound} render={(r) => `linha ${r.line}: ${r.codMun};${r.id}`} />
                  <ListBlock title="recusadas" tone="danger" items={namesReport.rejected} render={(r) => `linha ${r.line}: ${r.id} — ${r.reason}`} />
                </div>
              )}
            </Section>
          </fieldset>

          {busy && <p className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-accent-500" aria-hidden="true" />Processando {busy}…</p>}
          {error && <p className="flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800" role="alert"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}

          {lastReport && (
            <Section title="Relatório da última importação">
              <ImportReport report={lastReport} />
            </Section>
          )}
        </div>
        <div className="flex items-start gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-snug text-slate-600 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:text-[12px]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Reimportar o mesmo arquivo não duplica: a chave é município + ID. Nomes e contornos editados no sistema são mantidos, salvo com
          &quot;Sobrescrever edições&quot;. As comunidades ficam no IndexedDB deste navegador.
        </div>
      </div>
    </div>
  );
}
