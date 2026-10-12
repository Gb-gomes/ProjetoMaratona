import { useState } from 'react';
import {
  ShieldAlert, Plus, List, HeartPulse, Tractor, TriangleAlert, Info, ChevronDown, ChevronRight, History, Eye, EyeOff, MapPin,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { PRIORITY_CATEGORIES } from '../lib/priorityRecords.js';
import { MATCH_LABEL } from '../lib/priorityMatch.js';
import {
  ALERT_STATUS, ACTION_LABEL, DECISIONS, alertKey, recommendedAction,
} from '../lib/priorityAlerts.js';

const MATCH_TONE = { confirmed: 'danger', possible: 'warning', review: 'warning' };
const fmtMeters = (m) => `${Number(m).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export function CategoryChip({ category, compact = false }) {
  const A = category === 'A';
  const Icon = A ? HeartPulse : Tractor;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
        A ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-violet-50 text-violet-700 ring-violet-200'
      }`}
      title={PRIORITY_CATEGORIES[category]?.short}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {compact ? category : `${category} · ${PRIORITY_CATEGORIES[category]?.label ?? ''}`}
    </span>
  );
}

function SummaryCell({ label, value, tone = 'text-petrol-900' }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-center">
      <p className={`text-[16px] font-semibold leading-tight ${tone}`}>{value}</p>
      <p className="text-[10.5px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}

/**
 * Painel "Alertas de pontos prioritários": resumo da comparação do CSV com
 * o cadastro manual, lista de alertas e fluxo de revisão.
 */
export default function PriorityAlertsPanel({
  mode, phase, registry, analysis, analysisRef, gate, tolerance, onToleranceChange, toleranceLimits,
  focusedRecordId, onFocusRecord, onAction, operator, operatorLocked = false, onOpenRegistry, unitLabel, onShowOnMap,
}) {
  const [openKey, setOpenKey] = useState(null);
  const [showLimits, setShowLimits] = useState(false);
  const isReal = mode === 'real';
  const done = phase === 'done' && analysis;
  const records = registry.records ?? [];
  const activeCount = records.filter((r) => r.status === 'active').length;
  const byId = new Map(records.map((r) => [r.id, r]));

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="prio-title">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
        <h2 id="prio-title" className="text-[13.5px] font-semibold text-petrol-900 max-lg:text-[16px]">Alertas de pontos prioritários</h2>
        {done && !analysis.blocked && (
          <StatusBadge tone={analysis.alerts.length ? 'danger' : 'neutral'} className="ml-auto">
            {analysis.alerts.length} alerta(s)
          </StatusBadge>
        )}
      </div>

      <div className="space-y-2.5 px-3.5 py-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onOpenRegistry({ view: 'form', editingId: null })}
            disabled={registry.status !== 'ready'}
            className="inline-flex items-center gap-1.5 rounded-md bg-petrol-700 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-petrol-800 disabled:cursor-not-allowed disabled:bg-slate-300 max-lg:min-h-11 max-lg:text-[14px]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Cadastrar ponto prioritário
          </button>
          <button
            type="button"
            onClick={() => onOpenRegistry({ view: 'list' })}
            disabled={registry.status !== 'ready'}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 max-lg:min-h-11 max-lg:text-[14px]"
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            Cadastro ({records.length})
          </button>
        </div>

        <p className={`flex gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-snug max-lg:text-[12.5px] ${
          isReal ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
        >
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {isReal
            ? 'Cadastro provisório salvo só neste navegador, sem controle de acesso. Não é o cadastro corporativo nem ambiente seguro para dados reais de clientes.'
            : 'Demonstração: registros fictícios, salvos separados do teste real.'}
        </p>

        {registry.status === 'error' && (
          <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[12px] text-red-700" role="alert">{registry.error}</p>
        )}

        {!done && registry.status === 'ready' && (
          <p className="text-[12px] leading-snug text-slate-600 max-lg:text-[14px]">
            A verificação roda junto com cada processamento do CSV. {activeCount} cadastro(s) ativo(s)
            {records.length > activeCount ? `, ${records.length - activeCount} inativo(s)` : ''}.
          </p>
        )}

        {done && (
          <label className="flex items-center gap-2 text-[11.5px] text-slate-600 max-lg:text-[13.5px]">
            Tolerância
            <input
              type="number"
              min={1}
              max={toleranceLimits.max}
              step={1}
              value={tolerance}
              onChange={(e) => onToleranceChange(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[12px] text-petrol-900 max-lg:min-h-11 max-lg:w-20"
              aria-describedby="tol-note"
            />
            m
            <span id="tol-note" className="rounded bg-amber-50 px-1 text-[10.5px] font-medium text-amber-800">parâmetro de teste</span>
          </label>
        )}

        {done && analysis.blocked && (
          <p className="flex gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[12px] text-red-700" role="alert">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {analysis.reason}
          </p>
        )}

        {done && !analysis.blocked && (
          <>

            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Resumo da comparação">
              <SummaryCell label="Pontos do CSV analisados" value={analysis.analyzed} />
              <SummaryCell label="Prioritários confirmados" value={analysis.counts.confirmed} tone="text-red-700" />
              <SummaryCell label="Possíveis correspond." value={analysis.counts.possible} tone="text-amber-700" />
              <SummaryCell label="Exigem revisão" value={analysis.counts.review} tone="text-amber-700" />
              <SummaryCell label="Sem correspondência identificada" value={analysis.counts.unmatchedPoints} />
              <SummaryCell label="Não comparados" value={analysis.notCompared} tone={analysis.notCompared ? 'text-red-700' : 'text-petrol-900'} />
            </div>

            {gate.blocked && (
              <p className="flex gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[12px] font-medium leading-snug text-red-800 max-lg:text-[14px]" role="alert">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {gate.message}
              </p>
            )}

            <div className="rounded-md border border-petrol-100 bg-petrol-50 px-2 py-1.5 text-[11.5px] leading-snug text-petrol-800 max-lg:text-[13px]">
              <button
                type="button"
                onClick={() => setShowLimits((v) => !v)}
                className="flex w-full items-center gap-1 text-left font-medium max-lg:min-h-11"
                aria-expanded={showLimits}
              >
                {showLimits ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                Limites desta verificação
              </button>
              <p className="mt-0.5">A ausência de correspondência não comprova que não há clientes prioritários afetados.</p>
              {showLimits && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {analysis.warnings.map((w) => <li key={w}>{w}</li>)}
                  <li>Só são comparados os registros cadastrados manualmente neste navegador; o cadastro corporativo não é consultado.</li>
                  <li>Proximidade não confirma a mesma unidade consumidora. A decisão é sempre da equipe responsável, conforme os procedimentos oficiais.</li>
                </ul>
              )}
            </div>

            {analysis.alerts.length === 0 ? (
              <p className="text-[12px] text-slate-600">Nenhum ponto do CSV se associou ao cadastro pelos critérios atuais.</p>
            ) : (
              <ul className="space-y-1.5" aria-label="Alertas">
                {analysis.alerts.map((a) => {
                  const key = alertKey(analysisRef.key, a.recordId);
                  const entry = registry.alerts[key];
                  const wf = ALERT_STATUS[entry?.status ?? 'novo'];
                  const open = openKey === key;
                  const focused = focusedRecordId === a.recordId;
                  return (
                    <li
                      key={key}
                      className={`rounded-md border ${a.category === 'A' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-violet-500'} ${
                        focused ? 'border-accent-400 bg-accent-50/50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => { setOpenKey(open ? null : key); onFocusRecord(a.recordId, !open); }}
                        aria-expanded={open}
                        className="w-full px-2 py-1.5 text-left max-lg:min-h-12 max-lg:px-3 max-lg:py-2.5"
                      >
                        <span className="flex flex-wrap items-center gap-1">
                          <CategoryChip category={a.category} compact />
                          <span className="text-[12.5px] font-semibold text-petrol-900 max-lg:text-[15px]">{a.recordId}</span>
                          <StatusBadge tone={MATCH_TONE[a.matchStatus]} className="!px-1.5 !text-[10.5px]">{MATCH_LABEL[a.matchStatus]}</StatusBadge>
                          <StatusBadge tone={wf.tone} className="!px-1.5 !text-[10.5px]">{wf.label}</StatusBadge>
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-slate-600 max-lg:text-[13px]">
                          CSV {a.primaryPointLabel} · {fmtMeters(a.distanceMeters)}
                          {a.primaryUnitId && unitLabel(a.primaryUnitId) ? ` · ${unitLabel(a.primaryUnitId)}` : ''}
                        </span>
                      </button>
                      {open && (
                        <AlertDetails
                          alert={a}
                          entry={entry}
                          record={byId.get(a.recordId)}
                          analysisRef={analysisRef}
                          operator={operator}
                          operatorLocked={operatorLocked}
                          onAction={(payload) => onAction(key, payload)}
                          onShowOnMap={onShowOnMap ? () => onShowOnMap(a.recordId) : null}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const ACTION_OPTIONS = {
  novo: ['analisar', 'encaminhar', 'concluir', 'anotar'],
  em_analise: ['encaminhar', 'concluir', 'anotar'],
  encaminhado: ['analisar', 'concluir', 'anotar'],
  concluido: ['reabrir', 'anotar'],
};
const ACTION_BUTTON = {
  analisar: 'Marcar em análise', encaminhar: 'Registrar encaminhamento', concluir: 'Concluir análise', reabrir: 'Reabrir', anotar: 'Adicionar observação',
};

function AlertDetails({
  alert, entry, record, analysisRef, operator, operatorLocked, onAction, onShowOnMap,
}) {
  const [showRecord, setShowRecord] = useState(false);
  const status = entry?.status ?? 'novo';
  const options = ACTION_OPTIONS[status];
  const [action, setAction] = useState(options[0]);
  const [by, setBy] = useState(operator ?? '');
  const [decision, setDecision] = useState('');
  const [forwardedTo, setForwardedTo] = useState('');
  const [note, setNote] = useState('');
  const current = options.includes(action) ? action : options[0];

  const submit = (e) => {
    e.preventDefault();
    const ok = onAction({
      action: current, by, decision, forwardedTo, note,
    });
    if (ok) { setNote(''); setDecision(''); setForwardedTo(''); }
  };

  const field = 'w-full rounded border border-slate-300 bg-white px-2 py-1 text-[12px] text-petrol-900 max-lg:min-h-11';
  return (
    <div className="space-y-2 border-t border-slate-100 px-2 pb-2 pt-1.5 text-[11.5px] leading-snug text-slate-700 max-lg:space-y-3 max-lg:px-3 max-lg:pb-3 max-lg:text-[13.5px]">
      {onShowOnMap && (
        <button
          type="button"
          onClick={onShowOnMap}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-petrol-300 bg-white px-3 text-[15px] font-medium text-petrol-700 lg:hidden"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />
          Ver no mapa
        </button>
      )}
      <div>
        <p className="font-semibold text-petrol-900">Situação encontrada</p>
        <ul className="list-disc pl-4">{alert.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {alert.points.length > 1 && (
          <p className="mt-0.5 text-slate-500">
            Pontos envolvidos: {alert.points.map((p) => `${p.label} (${fmtMeters(p.distanceMeters)}${p.idMatch ? ', código coincide' : ''})`).join('; ')}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[86px_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-slate-500">Desligamento</dt>
        <dd>{analysisRef.outageId ?? 'Ordem não informada'} · {analysisRef.dateLabel ?? 'data não informada'}</dd>
        <dt className="text-slate-500">Arquivo</dt>
        <dd className="break-all">{analysisRef.fileName ?? '—'}</dd>
        <dt className="text-slate-500">Origem</dt>
        <dd>
          Cadastro manual local ({alert.recordId}
          {record?.updatedAt ? `, atualizado em ${fmtDateTime(record.updatedAt)}` : ''}) × ponto do CSV. Evidência: {alert.evidence}.
        </dd>
        <dt className="text-slate-500">Categoria</dt>
        <dd>{PRIORITY_CATEGORIES[alert.category]?.short}</dd>
      </dl>
      <p className="rounded border border-accent-200 bg-accent-50 px-2 py-1 text-accent-900">
        <span className="font-semibold">Ação recomendada para revisão: </span>
        {recommendedAction(alert)}
      </p>

      <div>
        <button
          type="button"
          onClick={() => setShowRecord((v) => !v)}
          className="inline-flex items-center gap-1 font-medium text-petrol-700 hover:underline max-lg:min-h-11"
          aria-expanded={showRecord}
        >
          {showRecord ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <Eye className="h-3 w-3" aria-hidden="true" />}
          {showRecord ? 'Ocultar detalhes do cadastro' : 'Mostrar detalhes do cadastro'}
        </button>
        {showRecord && (
          record ? (
            <dl className="mt-1 grid grid-cols-[86px_1fr] gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-1">
              {record.label && (<><dt className="text-slate-500">Identificação</dt><dd>{record.label}</dd></>)}
              {record.ucCode && (<><dt className="text-slate-500">Código da UC</dt><dd>{record.ucCode}</dd></>)}
              <dt className="text-slate-500">Situação</dt><dd>{record.situation}</dd>
              {record.activity && (<><dt className="text-slate-500">Atividade</dt><dd>{record.activity}</dd></>)}
              {record.impact && (<><dt className="text-slate-500">Impacto</dt><dd>{record.impact}</dd></>)}
              {record.validationRef && (<><dt className="text-slate-500">Validação</dt><dd>{record.validationRef}</dd></>)}
              {record.notes && (<><dt className="text-slate-500">Observações</dt><dd>{record.notes}</dd></>)}
              <dd className="col-span-2 mt-0.5 text-[10.5px] text-slate-500">Sem controle de acesso nesta etapa: não exiba esta área em telas compartilhadas.</dd>
            </dl>
          ) : <p className="mt-1 text-red-700">Registro não encontrado no cadastro (pode ter sido excluído).</p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
        <p className="font-semibold text-petrol-900">Revisão</p>
        {entry?.decision && <p>Decisão: <b>{entry.decision}</b> ({entry.decidedBy}, {fmtDateTime(entry.decidedAt)})</p>}
        {entry?.forwardedTo && <p>Encaminhado para: <b>{entry.forwardedTo}</b></p>}
        <div className="grid grid-cols-2 gap-1.5 max-sm:grid-cols-1">
          <label className="block">
            <span className="text-slate-500">Ação</span>
            <select value={current} onChange={(e) => setAction(e.target.value)} className={field}>
              {options.map((o) => <option key={o} value={o}>{ACTION_BUTTON[o]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-500">Responsável *</span>
            {operatorLocked
              ? <input value={operator} readOnly title="Identificado pelo login do Cloudflare Access" className={`${field} cursor-default bg-slate-50 text-petrol-800`} />
              : <input value={by} onChange={(e) => setBy(e.target.value)} className={field} autoComplete="off" />}
          </label>
        </div>
        {current === 'concluir' && (
          <label className="block">
            <span className="text-slate-500">Decisão operacional *</span>
            <select value={decision} onChange={(e) => setDecision(e.target.value)} className={field}>
              <option value="">Selecione…</option>
              {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
        {current === 'encaminhar' && (
          <label className="block">
            <span className="text-slate-500">Encaminhado para *</span>
            <input value={forwardedTo} onChange={(e) => setForwardedTo(e.target.value)} className={field} placeholder="Área ou equipe" />
          </label>
        )}
        <label className="block">
          <span className="text-slate-500">Observações{current === 'reabrir' || current === 'anotar' ? ' *' : ''}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={field} placeholder="Sem dados médicos" />
        </label>
        <button type="submit" className="rounded-md bg-petrol-700 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-petrol-800 max-lg:min-h-11 max-lg:w-full max-lg:text-[15px]">
          {ACTION_BUTTON[current]}
        </button>
      </form>

      {entry?.history?.length > 0 && (
        <div>
          <p className="flex items-center gap-1 font-semibold text-petrol-900"><History className="h-3 w-3" aria-hidden="true" />Histórico</p>
          <ol className="mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
            {[...entry.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="text-slate-500">{fmtDateTime(h.at)}</span> · <b>{ACTION_LABEL[h.action] ?? h.action}</b> · {h.by}
                {h.decision && <> · {h.decision}</>}
                {h.forwardedTo && <> · para {h.forwardedTo}</>}
                {h.note && <span className="block text-slate-600">{h.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
