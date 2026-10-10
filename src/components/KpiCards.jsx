import { MapPin, MapPinned, CalendarClock, Radio, TriangleAlert } from 'lucide-react';

function Card({ icon: Icon, label, value, description, loading, highlight, extra }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-md border bg-white px-3.5 py-2.5 shadow-panel ${highlight ? 'border-accent-200' : 'border-slate-200'}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${highlight ? 'bg-accent-50 text-accent-600' : 'bg-petrol-50 text-petrol-600'}`} aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-tight text-slate-500">{label}</p>
        {loading ? (
          <span className="mt-1 block h-5 w-16 animate-pulse rounded bg-slate-200" aria-label="Carregando" />
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[20px] font-semibold leading-tight text-petrol-900">
            {value}
            {extra}
          </p>
        )}
        <p className="text-[11.5px] leading-tight text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function Chip({ tone, title, children, icon }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${cls}`} title={title}>
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
    <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
      <Card
        icon={MapPin}
        label="Pontos importados"
        value={done ? summary.imported : '—'}
        description={!done ? waiting : isReal ? `${summary.valid} válidos | ${summary.invalid} inválidos` : 'Registros geográficos da demonstração'}
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
    </div>
  );
}
