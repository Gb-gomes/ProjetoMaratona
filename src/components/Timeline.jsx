import { Check } from 'lucide-react';

/**
 * Linha do tempo operacional. A etapa atual é derivada do estado da
 * interface; nenhum envio real de aviso é simulado.
 */
export default function Timeline({
  outage, phase, noticeStatus, mode = 'demo', priorityPending = false,
}) {
  const isReal = mode === 'real';
  const approved = noticeStatus === 'approved';

  const steps = [
    {
      title: 'Programação',
      when: outage.planningDaysBefore != null ? `Até ${outage.planningDaysBefore} dias antes` : 'Definida pela engenharia',
      text: 'O desligamento é programado pela equipe responsável.',
      state: 'done',
    },
    {
      title: 'Análise territorial',
      when: 'O sistema identifica as regiões afetadas',
      text: 'O CSV é processado e os pontos são associados às unidades territoriais disponíveis.',
      state: phase === 'done' ? 'done' : 'current',
      tag: phase === 'processing' ? 'Em processamento' : phase === 'done' ? null : 'Aguardando processamento',
    },
    {
      title: 'Comunicação ao cliente',
      when: outage.noticeDaysBefore != null ? `${outage.noticeDaysBefore} dias antes (${outage.noticeDate})` : 'Antecedência não informada',
      text: 'O operador revisa o aviso e prepara a comunicação.',
      state: phase !== 'done' ? 'upcoming' : approved ? 'done' : 'current',
      tag: phase !== 'done' ? null
        : priorityPending ? 'Revisão de pontos prioritários pendente'
          : approved ? (isReal ? 'Aprovado no teste, sem envio' : 'Aprovado para demonstração, sem envio') : 'Em revisão',
    },
    {
      title: 'Desligamento',
      when: `${outage.dateLabel}${outage.start && outage.end ? `, ${outage.start} às ${outage.end}` : ''}`,
      text: isReal ? 'Data e horário informados pelo operador.' : 'Data e horário da demonstração.',
      state: 'upcoming',
    },
  ];

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="border-b border-slate-100 px-3.5 py-2.5 text-[13.5px] font-semibold text-petrol-900">
        Linha do tempo operacional
      </h2>
      <ol className="px-3.5 py-3">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-3 last:pb-0" aria-current={s.state === 'current' ? 'step' : undefined}>
            {i < steps.length - 1 && (
              <span
                className={`absolute left-[9px] top-5 h-[calc(100%-14px)] w-0.5 ${s.state === 'done' ? 'bg-emerald-500' : 'bg-slate-200'}`}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-10 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                s.state === 'done' ? 'border-emerald-500 bg-emerald-500 text-white'
                  : s.state === 'current' ? 'border-accent-500 bg-accent-50'
                    : 'border-slate-300 bg-white'
              }`}
              aria-hidden="true"
            >
              {s.state === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
              {s.state === 'current' && <span className="h-2 w-2 rounded-full bg-accent-500" />}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold leading-tight text-petrol-900">
                {i + 1}. {s.title}
              </p>
              <p className="text-[11.5px] text-petrol-600">{s.when}</p>
              <p className="text-[11.5px] leading-snug text-slate-500">{s.text}</p>
              {s.tag && (
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                  s.state === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-accent-50 text-accent-800'
                }`}
                >
                  {s.tag}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
