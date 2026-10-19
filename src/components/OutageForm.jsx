import { Zap, TriangleAlert } from 'lucide-react';
import { Panel, PanelHeader } from './ui/Panel.jsx';

const FIELDS = [
  { key: 'orderId', label: 'Ordem', type: 'text', placeholder: 'Não informado' },
  { key: 'feeder', label: 'Alimentador', type: 'text', placeholder: 'Não informado' },
  { key: 'reason', label: 'Motivo', type: 'text', placeholder: 'Não informado' },
  { key: 'date', label: 'Data', type: 'date' },
  { key: 'start', label: 'Início', type: 'time' },
  { key: 'end', label: 'Término', type: 'time' },
  { key: 'noticeDate', label: 'Data do aviso', type: 'date' },
  { key: 'audience', label: 'Pessoal de…', type: 'text', hint: 'Público citado na carta' },
];

/**
 * Dados do desligamento no modo com dados reais. Começa vazio: nenhuma
 * data fictícia é usada. Os valores ficam só na memória da página.
 */
export default function OutageForm({
  form, view, onChange, defaultAudience,
}) {
  return (
    <Panel labelledBy="outage-title">
      <PanelHeader id="outage-title" icon={Zap} title="Desligamento programado" />
      <div className="space-y-1.5 px-3.5 py-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="grid grid-cols-[96px_1fr] items-center gap-2 text-[12px] max-lg:grid-cols-[104px_minmax(0,1fr)] max-lg:text-[14px]">
            <span className="text-slate-500">{f.label}</span>
            <input
              type={f.type}
              value={form[f.key]}
              placeholder={f.key === 'audience' ? (defaultAudience ?? '').toUpperCase() : f.placeholder}
              title={f.hint}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[12px] font-medium max-lg:min-h-11 text-petrol-900 placeholder:font-normal placeholder:text-slate-400"
            />
          </label>
        ))}
        <p className="text-[11px] leading-snug text-slate-500">
          Antecedência: {view.noticeDaysBefore != null ? `${view.noticeDaysBefore} dia(s)` : 'não informada'}.
          Informe os dados da ordem oficial; campos vazios ficam como &quot;não informado&quot;.
        </p>
        {view.problems.map((p) => (
          <p key={p} className="flex gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900" role="alert">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {p}
          </p>
        ))}
      </div>
    </Panel>
  );
}
