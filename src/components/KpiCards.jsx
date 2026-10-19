import { MapPin, MapPinned, CalendarClock, Radio, TriangleAlert } from 'lucide-react';

/** Uma célula da faixa de indicadores: rótulo, valor e uma linha de contexto. */
function Card({ icon: Icon, label, value, description, loading, highlight, extra }) {
  return (
    <div className="min-w-0 bg-white px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-[12px] leading-tight text-slate-500">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${highlight ? 'text-accent-600' : 'text-petrol-400'}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1">
        {loading ? (
          <span className="block h-6 w-16 animate-pulse rounded bg-slate-200" aria-hidden="true" />
        ) : (
          <span className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[20px] font-semibold leading-6 ${highlight ? 'text-accent-700' : 'text-petrol-900'}`}>
            {value}
            {extra}
          </span>
        )}
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-slate-500">{description}</span>
      </dd>
    </div>
  );
}

function Chip({ tone, title, children, icon }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`} title={title}>
      {icon && <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Indicadores. Pontos e regiões derivam do resumo do processamento
 * (lib/summary.js); datas derivam dos dados do desligamento. No modo
 * real, nada é preenchido com valores fixos.
 */
export default function KpiCards({
  result, summary, phase, outage, mode = 'demo',
}) {
  const done = phase === 'done' && result && summary;
  const loading = phase === 'processing';
  const waiting = 'Aguardando processamento';
  const isReal = mode === 'real';

  return (
    <section aria-label="Indicadores do desligamento" aria-busy={loading || undefined} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
      <dl className="grid grid-cols-2 gap-px bg-slate-100 xl:grid-cols-4">
        <Card
          icon={MapPin}
          label="Pontos importados"
          value={done ? summary.imported : '—'}
          description={!done ? waiting : isReal ? `${summary.valid} válidos · ${summary.invalid} inválidos` : 'Registros geográficos da demonstração'}
          loading={loading}
          extra={done && isReal && summary.warnings > 0 && (
            <Chip title="Registros válidos com alerta para revisão" icon>{summary.warnings} p/ revisão</Chip>
          )}
        />
        <Card
          icon={MapPinned}
          label="Regiões identificadas"
          value={done ? summary.unitCount : '—'}
          description={done ? (isReal ? `${summary.matched} pontos associados unicamente` : 'Unidades territoriais distintas') : waiting}
          loading={loading}
          highlight={!!done}
          extra={done && (
            <>
              <Chip tone={summary.unmatched ? 'danger' : 'ok'} title="Pontos sem correspondência com uma unidade territorial" icon={summary.unmatched > 0}>
                {summary.unmatched} sem correspondência
              </Chip>
              {isReal && (
                <Chip tone={summary.ambiguous ? 'warn' : 'ok'} title="Pontos sobre limites ou em unidades sobrepostas" icon={summary.ambiguous > 0}>
                  {summary.ambiguous} ambíguo(s)
                </Chip>
              )}
            </>
          )}
        />
        <Card
          icon={CalendarClock}
          label="Desligamento programado"
          value={outage.dateLabel}
          description={outage.start && outage.end ? `${outage.start} às ${outage.end}` : 'Horário não informado'}
        />
        <Card
          icon={Radio}
          label="Aviso ao cliente"
          value={outage.noticeDate ?? 'Não informado'}
          description={outage.noticeDaysBefore != null ? `${outage.noticeDaysBefore} dias antes` : 'Antecedência não informada'}
        />
      </dl>
    </section>
  );
}

/** Versão compacta dos indicadores para o topo da tela Regiões no celular. */
export function KpiStrip({
  result, summary, phase, outage, mode = 'demo',
}) {
  const done = phase === 'done' && result && summary;
  const isReal = mode === 'real';
  const cells = [
    { label: 'pontos', value: done ? summary.imported : '—' },
    { label: 'regiões', value: done ? summary.unitCount : '—', highlight: true },
    { label: 'desligamento', value: outage.dateLabel, small: true, sub: outage.start && outage.end ? `${outage.start}–${outage.end}` : null },
    { label: 'aviso ao cliente', value: outage.noticeDate ?? 'Não informado', small: true, sub: outage.noticeDaysBefore != null ? `${outage.noticeDaysBefore} dias antes` : null },
  ];
  return (
    <section aria-label="Indicadores" className="rounded-md border border-slate-200 bg-white shadow-panel">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-slate-200 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col bg-white px-2 py-2 text-center">
            <dt className="truncate text-[13px] text-slate-500">{c.label}</dt>
            <dd className={`order-first truncate font-semibold leading-tight ${c.highlight ? 'text-accent-700' : 'text-petrol-900'} ${c.small ? 'text-[16px]' : 'text-[20px]'}`}>
              {c.value}
              {c.sub && <span className="block truncate text-[13px] font-normal text-slate-600">{c.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {done && (summary.unmatched > 0 || (isReal && summary.ambiguous > 0)) && (
        <p className="flex flex-wrap gap-1.5 border-t border-slate-200 px-2.5 py-1.5">
          {summary.unmatched > 0 && <Chip tone="danger" icon>{summary.unmatched} sem correspondência</Chip>}
          {isReal && summary.ambiguous > 0 && <Chip tone="warn" icon>{summary.ambiguous} ambíguo(s)</Chip>}
        </p>
      )}
    </section>
  );
}
