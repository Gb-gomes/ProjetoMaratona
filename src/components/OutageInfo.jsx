import { Zap } from 'lucide-react';
import { Panel, PanelHeader } from './ui/Panel.jsx';

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
    <Panel labelledBy="outage-title">
      <PanelHeader id="outage-title" icon={Zap} title="Desligamento programado" />
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 px-3.5 py-3 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-petrol-900">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
