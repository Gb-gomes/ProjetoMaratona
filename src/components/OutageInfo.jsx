import { Zap } from 'lucide-react';

/** Informações do desligamento programado (dados fictícios). */
export default function OutageInfo({ outage }) {
  const rows = [
    ['Ordem', outage.id],
    ['Alimentador', outage.feeder],
    ['Motivo', outage.reason],
    ['Programado em', outage.scheduledOn],
    ['Data', outage.dateLabel],
    ['Horário', `${outage.start} às ${outage.end}`],
  ];
  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="outage-title">
      <h2 id="outage-title" className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-[13.5px] font-semibold text-petrol-900">
        <Zap className="h-4 w-4 text-petrol-500" aria-hidden="true" />
        Desligamento programado
      </h2>
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 px-3.5 py-2.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-petrol-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
