import {
  ArrowRight, ArrowDown, Copy, ShieldCheck, WandSparkles, TriangleAlert, CircleCheck, FileText, Info,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { countCharacters } from '../lib/communicationUtils.js';
import { RADIO_MONTHLY_COST_LABEL } from '../config.js';

const NOTICE_STATUS = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  edited: { label: 'Rascunho editado', tone: 'info' },
  approved: { label: 'Aprovado para demonstração', tone: 'success' },
};
const REAL_APPROVED = { label: 'Aprovado no teste (local)', tone: 'success' };

function ColumnHeader({ title, badge, badgeTone, subtitle, right }) {
  return (
    <div className="mb-2 flex items-start gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-petrol-900">{title}</h3>
          <StatusBadge tone={badgeTone}>{badge}</StatusBadge>
        </div>
        {subtitle && <p className="text-[11.5px] text-slate-500">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}

/** Indicador de granularidade da comunicação (sem cálculo financeiro). */
function EfficiencyIndicator({ done, total, units }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-md border border-petrol-100 bg-petrol-50 px-2.5 py-2 text-center" aria-labelledby="eff-title">
      <p id="eff-title" className="text-[12.5px] font-semibold text-petrol-900">Transformação da comunicação</p>
      <div className="flex flex-1 flex-col items-center justify-center gap-0.5">
        <p className="text-[24px] font-semibold leading-none text-petrol-800">{done ? total : '—'}</p>
        <p className="text-[11.5px] text-slate-600">pontos individuais</p>
        <ArrowDown className="my-0.5 h-4 w-4 text-accent-500" aria-hidden="true" />
        <p className="text-[24px] font-semibold leading-none text-accent-700">{done ? units : '—'}</p>
        <p className="text-[11px] leading-tight text-slate-600">unidades territoriais identificadas</p>
      </div>
      <p className="text-[11.5px] font-medium leading-tight text-petrol-700">Menos itens para organizar no aviso</p>
      <p className="mt-1.5 border-t border-petrol-100 pt-1.5 text-[10px] leading-snug text-slate-500">
        Custo mensal de rádio informado pela organização: {RADIO_MONTHLY_COST_LABEL}. A economia potencial depende da
        contratação e do modelo de transmissão.
      </p>
    </div>
  );
}

export default function CommunicationPanel({
  mode = 'demo', phase, result, traditionalText, propertyMapped = true, notice, onNoticeChange, onGenerate, onCopy, onApprove,
  selectedCount, pendingUnits = [], approvalBlocker, notes = [],
}) {
  const done = phase === 'done' && result;
  const isReal = mode === 'real';
  const noSelection = done && selectedCount === 0;
  const status = isReal && notice.status === 'approved' ? REAL_APPROVED : NOTICE_STATUS[notice.status];
  const chars = countCharacters(notice.text);

  return (
    <section className="rounded-md 2xl:h-full border border-slate-200 bg-white p-3.5 shadow-panel" aria-labelledby="comm-title">
      <h2 id="comm-title" className="sr-only">Comunicação rural</h2>
      <div className="grid h-full gap-3 lg:grid-cols-[minmax(0,1fr)_212px_minmax(0,1.2fr)] 2xl:grid-rows-[minmax(0,1fr)]">
        {/* Comunicação tradicional */}
        <div className="flex min-h-0 flex-col 2xl:h-full">
          <ColumnHeader
            title="Comunicação Tradicional"
            badge="Listagem individual"
            badgeTone="neutral"
            subtitle={isReal ? 'Aviso montado com os nomes de propriedade do CSV' : 'Exemplo de aviso com nomes de propriedades'}
          />
          {done && isReal && !traditionalText ? (
            <div className="flex min-h-[110px] flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-center text-[12px] leading-snug text-slate-500">
              {propertyMapped
                ? 'Os registros não têm nomes de propriedade preenchidos.'
                : 'O CSV não tem coluna de propriedade mapeada; a listagem individual não pode ser montada. Nenhum nome é inventado.'}
            </div>
          ) : done ? (
            <>
              <label htmlFor="traditional-text" className="sr-only">Texto da comunicação tradicional (somente leitura)</label>
              <textarea
                id="traditional-text"
                readOnly
                value={traditionalText}
                className="min-h-[110px] flex-1 resize-none rounded-md border border-slate-200 bg-slate-50 2xl:min-h-0 px-3 py-2 text-[12px] leading-[1.45] text-slate-700"
              />
              <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-slate-500">
                <span>{isReal ? `${result.valid} pontos válidos do CSV` : `${result.total} pontos individuais considerados na demonstração`}</span>
                <span>{countCharacters(traditionalText).toLocaleString('pt-BR')} caracteres</span>
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Indicador */}
        <div className="hidden min-h-0 lg:block">
          <EfficiencyIndicator done={!!done} total={result?.valid} units={result?.units.length} />
        </div>

        {/* Comunicação por região */}
        <div className="flex min-h-0 flex-col 2xl:h-full">
          <ColumnHeader
            title="Carta para as rádios"
            badge="Modelo Energisa"
            badgeTone="progress"
            subtitle={isReal ? 'Gerada a partir das regiões selecionadas. Prévia local, sem envio' : 'Carta demonstrativa, gerada a partir das regiões selecionadas'}
            right={done && <StatusBadge tone={status.tone} icon={notice.status === 'approved' ? CircleCheck : FileText}>{status.label}</StatusBadge>}
          />
          {done ? (
            <>
              {noSelection && (
                <p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900" role="alert">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Selecione pelo menos uma unidade territorial para gerar o aviso.
                </p>
              )}
              {notice.stale && !noSelection && (
                <p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-petrol-100 bg-petrol-50 px-2.5 py-1.5 text-[12px] text-petrol-800" role="status">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  A seleção de regiões mudou. Clique em Gerar aviso para atualizar o texto editado.
                </p>
              )}
              {!noSelection && approvalBlocker && (
                <p className="mb-1.5 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900" role="status">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {approvalBlocker}
                    {pendingUnits.length > 0 && ` Sem nome: região(ões) ${pendingUnits.map((u) => String(u.order).padStart(2, '0')).join(', ')}.`}
                  </span>
                </p>
              )}
              {!noSelection && notes.length > 0 && (
                <ul className="mb-1.5 space-y-0.5 rounded-md border border-petrol-100 bg-petrol-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-petrol-800" aria-label="Observações da carta">
                  {notes.map((n) => (
                    <li key={n} className="flex gap-1.5">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              <label htmlFor="regional-text" className="sr-only">Texto do aviso por região (editável)</label>
              <textarea
                id="regional-text"
                value={notice.text}
                onChange={(e) => onNoticeChange(e.target.value)}
                placeholder="A carta para as rádios aparece aqui."
                className="min-h-[220px] flex-1 resize-y rounded-md border-2 2xl:min-h-0 border-accent-300 bg-white px-3 py-2 text-[13px] leading-[1.5] text-petrol-900 focus:border-accent-500"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[11.5px] text-slate-500" aria-live="polite">
                  {chars.toLocaleString('pt-BR')} caracteres
                </span>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={noSelection}
                  className="inline-flex items-center gap-1.5 rounded-md bg-petrol-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-petrol-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Gerar carta
                </button>
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={!notice.text.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-petrol-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copiar texto
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={!notice.text.trim() || noSelection || notice.status === 'approved' || !!approvalBlocker}
                  title={approvalBlocker ?? undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Aprovar carta
                </button>
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[120px] flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-center text-[12.5px] text-slate-500">
      <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
      A comparação aparece após o processamento das coordenadas.
    </div>
  );
}
