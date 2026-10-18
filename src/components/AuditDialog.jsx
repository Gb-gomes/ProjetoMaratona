import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, CircleCheck, TriangleAlert, ListChecks } from 'lucide-react';
import { auditRows, toCsv, pointsByPlace } from '../lib/summary.js';

const STATUS_LABEL = { matched: 'Associado', unmatched: 'Sem correspondência territorial', ambiguous: 'Ambíguo (revisão)' };
const STATUS_CLASS = {
  matched: 'bg-petrol-50 text-petrol-800',
  unmatched: 'bg-red-50 text-red-700',
  ambiguous: 'bg-amber-50 text-amber-800',
};
const PAGE = 100;

function Stat({ label, value, tone }) {
  return (
    <div className="rounded border border-slate-200 px-2.5 py-1.5">
      <p className={`text-[16px] font-semibold ${tone ?? 'text-petrol-900'}`}>{value ?? '—'}</p>
      <p className="text-[11px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}

/**
 * Relatório de auditoria do processamento: resumo, verificação de
 * consistência e rastreio ponto → unidade. Exportação local (arquivo
 * baixado pelo navegador); coordenadas só são exibidas/exportadas se o
 * operador pedir.
 */
export default function AuditDialog({ open, onClose, result, summary, layerInfo, onFocusUnit }) {
  const [filter, setFilter] = useState('issues');
  const [placeFilter, setPlaceFilter] = useState('all'); // chave de pointsByPlace
  const [showCoords, setShowCoords] = useState(false);
  const [page, setPage] = useState(0);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => setPage(0), [filter, placeFilter]);
  const byPlace = useMemo(() => pointsByPlace(result), [result]);
  const placeKey = (p) => (p.place?.comunidade ? `c:${p.place.comunidade.regionId}` : p.place ? `l:${p.place.local ?? p.place.rotulo}` : null);

  const grouped = result?.grouping === 'place';
  const unitCode = useMemo(() => new Map((result?.units ?? []).map((u) => [u.id, u.code])), [result]);
  const rows = useMemo(() => {
    if (!result) return [];
    const byStatus = filter === 'all' ? result.points
      : filter === 'issues' ? result.points.filter((p) => p.status !== 'matched' || p.warnings.length)
        : result.points.filter((p) => p.status === filter);
    return placeFilter === 'all' ? byStatus : byStatus.filter((p) => placeKey(p) === placeFilter);
  }, [result, filter, placeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !result) return null;

  const download = () => {
    const blob = new Blob([toCsv(auditRows(result, { includeCoordinates: showCoords }))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_conecta_rural_${result.processedAt.slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const u = result.unique;
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/50 p-3 max-lg:p-0" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="audit-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-md bg-white shadow-xl max-lg:h-[100dvh] max-lg:max-h-none max-lg:max-w-none max-lg:rounded-none">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 max-lg:flex-wrap max-lg:gap-x-2 max-lg:gap-y-0 max-lg:pl-[max(1rem,env(safe-area-inset-left))] max-lg:pr-[max(0.25rem,env(safe-area-inset-right))] max-lg:pt-[max(0.25rem,env(safe-area-inset-top))] max-lg:pb-1">
          <ListChecks className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          <h2 id="audit-title" className="text-[14px] font-semibold text-petrol-900">Auditoria do processamento</h2>
          <span className="text-[12px] text-slate-500 max-lg:order-last max-lg:w-full max-lg:pb-1.5 max-lg:text-[13px]">
            {new Date(result.processedAt).toLocaleString('pt-BR')} · {layerInfo.title}
          </span>
          <button ref={closeRef} type="button" onClick={onClose} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px] max-lg:font-medium max-lg:text-petrol-700" aria-label="Fechar auditoria">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4 max-lg:min-h-0 max-lg:flex-1 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Registros importados" value={summary.imported} />
            <Stat label="Válidos" value={summary.valid} />
            <Stat label="Inválidos" value={summary.invalid} tone={summary.invalid ? 'text-red-700' : undefined} />
            <Stat label="Associados" value={summary.matched} />
            <Stat label="Sem correspondência" value={summary.unmatched} tone={summary.unmatched ? 'text-red-700' : undefined} />
            <Stat label="Ambíguos" value={summary.ambiguous} tone={summary.ambiguous ? 'text-amber-700' : undefined} />
            <Stat label="Unidades identificadas" value={summary.unitCount} />
            <Stat label="Alertas de revisão" value={summary.warnings} />
          </div>

          <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${summary.consistent ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {summary.consistent ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <p>
              Soma por unidade ({summary.unitSum}) {summary.unitSum === summary.matched ? '=' : '≠'} pontos associados unicamente ({summary.matched}).
              {' '}Associados + sem correspondência + ambíguos = {summary.matched + summary.unmatched + summary.ambiguous} de {summary.valid} válidos.
              {!summary.consistent && ' Inconsistência detectada: não use este resultado.'}
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
            <div className="text-[12px]">
              <h3 className="mb-1 font-semibold text-petrol-900">Contagens distintas</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                <dt className="text-slate-500">Pontos válidos</dt><dd>{summary.valid}</dd>
                <dt className="text-slate-500">Clientes únicos</dt><dd>{u.clients ?? 'não identificável (coluna não mapeada)'}</dd>
                <dt className="text-slate-500">Equipamentos únicos</dt><dd>{u.equipments ?? 'não identificável (coluna não mapeada)'}</dd>
                <dt className="text-slate-500">Propriedades únicas</dt><dd>{u.properties ?? 'não identificável (coluna não mapeada)'}</dd>
                <dt className="text-slate-500">Unidades territoriais distintas</dt><dd>{summary.unitCount}</dd>
              </dl>
              <p className="mt-1 text-[11px] text-slate-500">Pontos, clientes, equipamentos e propriedades são contados separadamente; um não equivale a outro.</p>
            </div>
            <div className="text-[12px]">
              <h3 className="mb-1 font-semibold text-petrol-900">{grouped ? 'Pontos por região (microrregião ou área do IBGE)' : `Pontos por unidade (${layerInfo.unitType})`}</h3>
              <div className="max-h-36 overflow-y-auto rounded border border-slate-200">
                <table className="min-w-full text-left">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr><th className="px-2 py-1">{grouped ? 'Região' : 'Código oficial'}</th><th className="px-2 py-1">{grouped ? 'Contexto (IBGE)' : 'Contexto oficial'}</th><th className="px-2 py-1 text-right">Pontos</th></tr></thead>
                  <tbody>
                    {result.units.map((unit) => (
                      <tr key={unit.id} className="border-t border-slate-100">
                        <td className={`px-2 py-1 ${grouped && unit.placeName ? '' : 'font-mono text-[12px]'}`}>
                          <button type="button" className="text-left text-petrol-700 underline-offset-2 hover:underline max-lg:min-h-11 max-lg:underline" onClick={() => { onFocusUnit(unit.id); onClose(); }}>{grouped && unit.placeName ? unit.placeName : unit.code}</button>
                        </td>
                        <td className="px-2 py-1 text-slate-600">{[unit.name, ...(unit.context ?? []).map((c) => c.value)].filter(Boolean).join(' · ') || 'sem denominação na camada'}</td>
                        <td className="px-2 py-1 text-right">{unit.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {byPlace.length > 0 && (
            <div className="text-[12px]">
              <h3 className="mb-1 font-semibold text-petrol-900">Pontos por comunidade ({byPlace.filter((x) => x.comunidade).length} comunidade(s))</h3>
              <div className="max-h-40 overflow-y-auto rounded border border-slate-200">
                <table className="min-w-full text-left">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr><th className="px-2 py-1">Comunidade / local</th><th className="px-2 py-1">Distrito · município (IBGE)</th><th className="px-2 py-1 text-right">Pontos</th></tr></thead>
                  <tbody>
                    {byPlace.map((g) => (
                      <tr key={g.key} className={`border-t border-slate-100 ${placeFilter === g.key ? 'bg-accent-50' : ''}`}>
                        <td className="px-2 py-1">
                          <button type="button" className="text-petrol-700 underline-offset-2 hover:underline max-lg:min-h-11" onClick={() => { setPlaceFilter((f) => (f === g.key ? 'all' : g.key)); setFilter('all'); }}>
                            {g.nome}
                          </button>
                          {g.confianca === 'baixa' && <span className="ml-1 text-amber-700" title="Localização aproximada (confiança baixa)">≈</span>}
                          {!g.comunidade && <span className="ml-1 text-slate-500">(sem comunidade)</span>}
                        </td>
                        <td className="px-2 py-1 text-slate-600">{g.detalhe}</td>
                        <td className="px-2 py-1 text-right">{g.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Clique para filtrar os registros abaixo. A exportação CSV inclui município, distrito e comunidade de cada ponto.</p>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <h3 className="font-semibold text-petrol-900">Registros processados</h3>
              {placeFilter !== 'all' && (
                <button type="button" onClick={() => setPlaceFilter('all')} className="rounded bg-accent-50 px-2 py-0.5 text-accent-800 ring-1 ring-accent-200 max-lg:min-h-11">
                  {byPlace.find((g) => g.key === placeFilter)?.nome} ✕
                </button>
              )}
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-[12px] max-lg:min-h-11 max-lg:w-full max-lg:min-w-0" aria-label="Filtrar registros">
                <option value="issues">Requer revisão (sem correspondência, ambíguos, alertas)</option>
                <option value="unmatched">Sem correspondência</option>
                <option value="ambiguous">Ambíguos</option>
                <option value="matched">Associados</option>
                <option value="all">Todos</option>
              </select>
              <label className="flex items-center gap-1.5 text-slate-600 max-lg:min-h-11 max-lg:gap-2 max-lg:text-[14px]">
                <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} className="accent-accent-500" />
                Mostrar coordenadas
              </label>
              <button type="button" onClick={download} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:text-[14px]">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Exportar CSV{showCoords ? ' (com coordenadas)' : ''}
              </button>
            </div>
            <div className="max-h-[38vh] overflow-auto rounded border border-slate-200 text-[12px]">
              <table className="min-w-full text-left">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1">Linha</th><th className="px-2 py-1">Id</th><th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Unidade (código oficial)</th>{byPlace.length > 0 && <th className="px-2 py-1">Localização</th>}<th className="px-2 py-1">Detalhe</th>
                    {showCoords && <><th className="px-2 py-1">Lat</th><th className="px-2 py-1">Lng</th></>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.key} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1">{p.line ?? '—'}</td>
                      <td className="px-2 py-1">{p.id ?? '—'}</td>
                      <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                      <td className="px-2 py-1 font-mono">{p.unitId ? (p.sectorCode ?? unitCode.get(p.unitId)) : p.candidates.length ? `candidatas: ${p.candidates.join(', ')}` : '—'}</td>
                      {byPlace.length > 0 && <td className="px-2 py-1 text-slate-600">{p.place?.rotulo ?? '—'}</td>}
                      <td className="px-2 py-1 text-slate-600">{[p.reason, ...p.warnings].filter(Boolean).join(' ') || '—'}</td>
                      {showCoords && <><td className="px-2 py-1">{p.lat}</td><td className="px-2 py-1">{p.lng}</td></>}
                    </tr>
                  ))}
                  {!pageRows.length && <tr><td colSpan={8} className="px-2 py-3 text-center text-slate-500">Nenhum registro neste filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[12px] text-slate-600">
                <button type="button" disabled={page === 0} onClick={() => setPage((n) => n - 1)} className="rounded border px-2 py-0.5 disabled:opacity-40 max-lg:min-h-11 max-lg:px-4 max-lg:text-[14px]">Anterior</button>
                <span>{page + 1} / {pages}</span>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)} className="rounded border px-2 py-0.5 disabled:opacity-40 max-lg:min-h-11 max-lg:px-4 max-lg:text-[14px]">Próxima</button>
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              Registros inválidos não entram no cruzamento; estão listados no painel de importação ({summary.invalid}).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
