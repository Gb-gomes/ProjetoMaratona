import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  History, Sparkles, TriangleAlert, CircleAlert, Info, Save, CircleCheck, Download, Trash2, X, BarChart3,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import {
  WINDOW_RECENT_DAYS, WINDOW_LONG_DAYS, SCOPES, computeFacts, typeOf, communityLabel,
} from '../lib/outageFacts.js';
import { historyToCsv } from '../lib/outageHistory.js';
import { buildReport, reportToCsv, PERIODS } from '../lib/outageReport.js';

const LEVEL = {
  alta: { label: 'Atenção alta', tone: 'danger', icon: TriangleAlert, row: 'border-red-200 bg-red-50 text-red-900' },
  media: { label: 'Atenção média', tone: 'warning', icon: CircleAlert, row: 'border-amber-200 bg-amber-50 text-amber-900' },
  info: { label: 'Sem pontos de atenção', tone: 'info', icon: Info, row: 'border-petrol-100 bg-petrol-50 text-petrol-800' },
};

const TYPE_CHIP = {
  programado: 'bg-white/80 text-petrol-800 ring-slate-300',
  acidental: 'bg-red-100 text-red-800 ring-red-300',
};

/** Filtro do embasamento: todos, só programados ou só acidentais. */
function ScopeTabs({ scope, onChange, counts }) {
  return (
    <div role="tablist" aria-label="Tipo de desligamento na análise" className="inline-flex rounded border border-slate-300 p-0.5 text-[12px] font-medium">
      {SCOPES.map((s) => (
        <button
          key={s.value}
          type="button"
          role="tab"
          aria-selected={scope === s.value}
          onClick={() => onChange(s.value)}
          className={`rounded px-2 py-0.5 max-lg:min-h-10 ${scope === s.value ? 'bg-petrol-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          {s.label} <span className="tabular-nums opacity-80">({counts?.[s.value] ?? 0})</span>
        </button>
      ))}
    </div>
  );
}

const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const hours = (h) => (h ? `${String(h).replace('.', ',')}h` : '—');

/** Etiqueta da IA: o texto do parecer é a próxima etapa; os fatos já são calculados. */
function AiTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-800 ring-1 ring-inset ring-accent-100" title="Os fatos abaixo são calculados pelo sistema. O parecer escrito por IA usará exatamente estes fatos e referências.">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      Base para parecer por IA
    </span>
  );
}

/**
 * Análise do desligamento em preparação a partir do histórico salvo.
 * Cada alerta cita as ordens (e datas) de onde saiu.
 */
export default function OutageAnalysisPanel({
  phase, record, history, currentId, canSave, saveBlocker, onSave, onRemove, savedRecord,
}) {
  const [dialog, setDialog] = useState(null); // null | { highlight }
  const [scope, setScope] = useState('todos');
  const facts = useMemo(() => (record ? computeFacts(record, history, { scope }) : null), [record, history, scope]);
  const done = phase === 'done' && facts;
  const accidental = record?.tipo === 'acidental';
  const lvl = done ? LEVEL[facts.level] : null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3.5 shadow-panel" aria-labelledby="analysis-title">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-petrol-500" aria-hidden="true" />
        <h2 id="analysis-title" className="text-[13.5px] font-semibold text-petrol-900">Análise do desligamento</h2>
        {lvl && <StatusBadge tone={lvl.tone} icon={lvl.icon}>{lvl.label}</StatusBadge>}
        <AiTag />
        <button
          type="button"
          onClick={() => setDialog({ view: 'relatorio', highlight: null })}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
          Relatório
        </button>
        <button
          type="button"
          onClick={() => setDialog({ view: 'registros', highlight: null })}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Histórico ({history.length})
        </button>
      </div>

      {!done ? (
        <p className="text-[12.5px] text-slate-600">
          Ao processar os pontos, o sistema cruza as comunidades afetadas com os desligamentos já registrados
          (recorrência, horas sem energia, conflitos de data, alimentador e antecedência do aviso).
        </p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <span className="text-[12px] font-medium text-slate-500">Embasamento com:</span>
            <ScopeTabs scope={scope} onChange={setScope} counts={facts.counts} />
            {accidental && <StatusBadge tone="danger">Este registro: acidental</StatusBadge>}
          </div>
          {/* Pontos de atenção, com referências */}
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-500">
              Pontos de atenção · {facts.historyCount} desligamento(s) {{ todos: '', programado: 'programado(s) ', acidental: 'acidental(is) ' }[scope]}no histórico
            </p>
            <ul className="space-y-1.5">
              {facts.alerts.map((a, i) => {
                const L = LEVEL[a.level];
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className={`flex gap-2 rounded border px-2.5 py-1.5 text-[12.5px] leading-snug ${L.row}`}>
                    <L.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p>{a.text}</p>
                      {a.refs.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {a.refs.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setDialog({ view: 'registros', highlight: r.id })}
                              className={`rounded px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset hover:brightness-95 ${TYPE_CHIP[r.tipo]}`}
                              title={`Desligamento ${r.tipo}. Abrir no histórico`}
                            >
                              {r.tipo === 'acidental' ? 'Acid. ' : ''}{r.label}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Fatos por comunidade */}
          <div className="min-w-0">
            <p className="mb-1.5 text-[12px] font-medium text-slate-500">Histórico das comunidades afetadas</p>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1 font-medium">Comunidade</th>
                    <th className="px-2 py-1 text-right font-medium" title={`Desligamentos anteriores nos últimos ${WINDOW_RECENT_DAYS} dias`}>{WINDOW_RECENT_DAYS}d</th>
                    <th className="px-2 py-1 text-right font-medium" title={`Desligamentos anteriores nos últimos ${WINDOW_LONG_DAYS} dias`}>{WINDOW_LONG_DAYS}d</th>
                    {scope === 'todos' && <th className="px-2 py-1 text-right font-medium" title={`Desligamentos acidentais nos últimos ${WINDOW_LONG_DAYS} dias`}>Acid.</th>}
                    <th className="px-2 py-1 text-right font-medium" title={`Horas sem energia nos últimos ${WINDOW_LONG_DAYS} dias`}>Horas</th>
                    <th className="px-2 py-1 font-medium">Último</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.byCommunity.map((c) => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className="max-w-[180px] truncate px-2 py-1 text-petrol-900" title={c.nome}>{c.nome}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${c.recent.length ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{c.recent.length}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-700">{c.long.length}</td>
                      {scope === 'todos' && <td className={`px-2 py-1 text-right tabular-nums ${c.acid90 ? 'text-red-700' : 'text-slate-500'}`}>{c.acid90}</td>}
                      <td className="px-2 py-1 text-right tabular-nums text-slate-700">{hours(c.hours90)}</td>
                      <td className="px-2 py-1 text-slate-600">{c.last ? `${c.last.daysAgo}d atrás` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          {savedRecord ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-800">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              Registrado no histórico{savedRecord.ordem ? ` (${savedRecord.ordem})` : ''}. Alterações posteriores atualizam o mesmo registro.
            </span>
          ) : (
            <span className="text-[12px] text-slate-500">
              {saveBlocker ?? (accidental
                ? 'Desligamento acidental: não há carta. Registre pelo botão ao lado.'
                : 'O registro é salvo ao aprovar a carta, ou agora pelo botão ao lado.')}
            </span>
          )}
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-petrol-700 px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-petrol-800 disabled:cursor-not-allowed disabled:bg-slate-300 max-lg:min-h-11"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {savedRecord ? 'Atualizar registro' : 'Registrar no histórico'}
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        Só dados do sistema (ordem, alimentador, motivo, datas, horários e comunidades com a quantidade de pontos).
        Nenhum dado de cliente é guardado.
      </p>

      {dialog && (
        <HistoryDialog
          records={history}
          scope={scope}
          onScopeChange={setScope}
          highlight={dialog.highlight}
          initialView={dialog.view}
          currentId={currentId}
          onRemove={onRemove}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

const download = (text, name) => {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const SCOPE_LABEL = { todos: 'Todos (programado + acidental)', programado: 'Programado', acidental: 'Acidental' };

function HistoryDialog({
  records: allRecords, scope, onScopeChange, highlight, initialView = 'registros', currentId, onRemove, onClose,
}) {
  const [view, setView] = useState(initialView);
  const [period, setPeriod] = useState('all');
  const report = useMemo(() => buildReport(allRecords, { scope, period }), [allRecords, scope, period]);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label;
  const counts = {
    todos: allRecords.length,
    programado: allRecords.filter((r) => typeOf(r) === 'programado').length,
    acidental: allRecords.filter((r) => typeOf(r) === 'acidental').length,
  };
  // A referência clicada sempre aparece, mesmo fora do filtro atual.
  const records = allRecords.filter((r) => scope === 'todos' || typeOf(r) === scope || r.id === highlight);
  const rowRef = useRef(null);
  useEffect(() => { rowRef.current?.scrollIntoView({ block: 'center' }); }, [highlight]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stamp = new Date().toISOString().slice(0, 10);
  const exportCsv = () => (view === 'relatorio'
    ? download(reportToCsv(report, { scopeLabel: SCOPE_LABEL[scope], periodLabel }), `relatorio_desligamentos_${scope}_${stamp}.csv`)
    : download(historyToCsv(records), `historico_desligamentos_${scope}_${stamp}.csv`));

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/50 p-3 max-lg:p-0" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="history-title" className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-md bg-white shadow-xl max-lg:h-[100dvh] max-lg:max-h-none max-lg:rounded-none">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <History className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          <h2 id="history-title" className="text-[14px] font-semibold text-petrol-900">Desligamentos</h2>
          <div role="tablist" aria-label="Visão" className="inline-flex rounded border border-slate-300 p-0.5 text-[12px] font-medium">
            {[['registros', 'Registros'], ['relatorio', 'Relatório']].map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded px-2 py-0.5 ${view === v ? 'bg-accent-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <ScopeTabs scope={scope} onChange={onScopeChange} counts={counts} />
          {view === 'relatorio' && (
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Período do relatório"
              className="rounded border border-slate-300 px-1.5 py-1 text-[12px] text-petrol-900"
            >
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={view === 'relatorio' ? !report.summary.total : !records.length}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Exportar CSV
          </button>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Fechar">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-auto">
          {view === 'relatorio' ? <ReportView report={report} scope={scope} periodLabel={periodLabel} /> : records.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-500">
              Nenhum desligamento neste filtro. Eles entram aqui ao aprovar a carta ou ao usar &quot;Registrar no histórico&quot;.
            </p>
          ) : (
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Tipo</th>
                  <th className="px-3 py-1.5 font-medium">Data</th>
                  <th className="px-3 py-1.5 font-medium">Horário</th>
                  <th className="px-3 py-1.5 font-medium">Ordem</th>
                  <th className="px-3 py-1.5 font-medium">Alimentador</th>
                  <th className="px-3 py-1.5 font-medium">Motivo / causa</th>
                  <th className="px-3 py-1.5 font-medium">Comunidades</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pontos</th>
                  <th className="px-3 py-1.5 text-right font-medium">Aviso</th>
                  <th className="px-3 py-1.5" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    ref={r.id === highlight ? rowRef : null}
                    className={`border-t border-slate-100 align-top ${r.id === highlight ? 'bg-accent-50' : ''}`}
                  >
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={typeOf(r) === 'acidental' ? 'danger' : 'info'}>{typeOf(r) === 'acidental' ? 'Acidental' : 'Programado'}</StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{dateBr(r.data)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                      {r.inicio ?? '—'}–{r.dataFim && r.dataFim !== r.data ? `${dateBr(r.dataFim).slice(0, 5)} ` : ''}{r.termino ?? '—'}
                      {r.duracaoH ? ` (${hours(r.duracaoH)})` : ''}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px]">
                      {r.ordem ?? '—'}
                      {r.id === currentId && <span className="ml-1 font-sans text-[11px] text-accent-700">(atual)</span>}
                    </td>
                    <td className="px-3 py-1.5">{r.alimentador ?? '—'}</td>
                    <td className="max-w-[180px] px-3 py-1.5">
                      {r.motivo ?? '—'}
                      {r.equipamento && <span className="block text-[11px] text-slate-500">{r.equipamento}</span>}
                    </td>
                    <td className="max-w-[260px] px-3 py-1.5 text-slate-700">{r.comunidades.map(communityLabel).join('; ')}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.totalPontos}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.antecedenciaDias != null ? `${r.antecedenciaDias}d` : '—'}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          // eslint-disable-next-line no-alert
                          if (window.confirm(`Excluir do histórico o desligamento ${r.ordem ?? ''} de ${dateBr(r.data)}?`)) onRemove(r.id);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Excluir ${r.ordem ?? 'registro'} de ${dateBr(r.data)}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'text-petrol-900' }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <p className={`text-[20px] font-semibold leading-tight tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11.5px] text-slate-500">{label}</p>
    </div>
  );
}

function ReportTable({ title, first, rows, scope }) {
  const both = scope === 'todos';
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-[12.5px] font-semibold text-petrol-900">{title}</h3>
      <div className="max-h-[260px] overflow-auto rounded border border-slate-200">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 font-medium">{first}</th>
              <th className="px-2 py-1 text-right font-medium">Total</th>
              {both && <th className="px-2 py-1 text-right font-medium">Prog.</th>}
              {both && <th className="px-2 py-1 text-right font-medium">Acid.</th>}
              <th className="px-2 py-1 text-right font-medium">Horas</th>
              <th className="px-2 py-1 text-right font-medium">Pontos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-t border-slate-100">
                <td className="max-w-[200px] truncate px-2 py-1 text-petrol-900" title={g.label}>{g.label}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{g.total}</td>
                {both && <td className="px-2 py-1 text-right tabular-nums text-slate-600">{g.programado}</td>}
                {both && <td className={`px-2 py-1 text-right tabular-nums ${g.acidental ? 'text-red-700' : 'text-slate-400'}`}>{g.acidental}</td>}
                <td className="px-2 py-1 text-right tabular-nums text-slate-700">{hours(g.horas)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-700">{g.pontos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Relatório do histórico: visão geral (programado + acidental) ou de um tipo, por período. */
function ReportView({ report, scope, periodLabel }) {
  const s = report.summary;
  if (!s.total) {
    return <p className="px-4 py-6 text-center text-[13px] text-slate-500">Nenhum desligamento neste recorte ({periodLabel.toLowerCase()}).</p>;
  }
  return (
    <div className="space-y-4 p-4">
      <p className="text-[12px] text-slate-500">
        {SCOPE_LABEL[scope]} · {periodLabel}. Base para o relatório por IA: os números abaixo são calculados pelo sistema.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Desligamentos" value={s.total} />
        <Stat label="Programados" value={s.programado} />
        <Stat label="Acidentais" value={s.acidental} tone={s.acidental ? 'text-red-700' : 'text-petrol-900'} />
        <Stat label="Horas sem energia" value={hours(s.horas)} />
        <Stat label="Comunidades afetadas" value={s.comunidades} />
        <Stat label="Pontos afetados (soma)" value={s.pontos} />
        <Stat label="Duração média" value={s.duracaoMedia ? hours(s.duracaoMedia) : '—'} />
        <Stat label="Antecedência média (programados)" value={s.antecedenciaMedia != null ? `${String(s.antecedenciaMedia).replace('.', ',')} dias` : '—'} />
      </div>
      <ReportTable title="Comunidades mais afetadas" first="Comunidade" rows={report.communities} scope={scope} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportTable title="Por alimentador" first="Alimentador" rows={report.feeders} scope={scope} />
        <ReportTable title="Por motivo / causa" first="Motivo / causa" rows={report.reasons} scope={scope} />
      </div>
    </div>
  );
}
