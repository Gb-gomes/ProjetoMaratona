import { Zap, TriangleAlert } from 'lucide-react';
import { ACCIDENT_CAUSES } from '../lib/outage.js';

const SCHEDULED_FIELDS = [
  { key: 'orderId', label: 'Ordem', type: 'text', placeholder: 'Não informado' },
  { key: 'feeder', label: 'Alimentador', type: 'text', placeholder: 'Não informado' },
  { key: 'reason', label: 'Motivo', type: 'text', placeholder: 'Não informado' },
  { key: 'date', label: 'Data', type: 'date' },
  { key: 'start', label: 'Início', type: 'time' },
  { key: 'end', label: 'Término', type: 'time' },
  { key: 'noticeDate', label: 'Data do aviso', type: 'date' },
  { key: 'audience', label: 'Pessoal de…', type: 'text', hint: 'Público citado na carta' },
];

const ACCIDENTAL_FIELDS = [
  { key: 'orderId', label: 'Ocorrência', type: 'text', placeholder: 'Nº da ocorrência' },
  { key: 'feeder', label: 'Alimentador', type: 'text', placeholder: 'Não informado' },
  { key: 'device', label: 'Equipamento atuado', type: 'text', placeholder: 'Ex.: religador, chave fusível' },
  { key: 'reason', label: 'Causa', type: 'select', options: ACCIDENT_CAUSES },
  { key: 'date', label: 'Data da falta', type: 'date' },
  { key: 'start', label: 'Início da falta', type: 'time' },
  { key: 'endDate', label: 'Restabelecido em', type: 'date', hint: 'Vazio = mesmo dia da falta' },
  { key: 'end', label: 'Restabelecido às', type: 'time' },
  { key: 'notes', label: 'Observações', type: 'text', placeholder: 'Opcional' },
];

const INPUT = 'min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[12px] font-medium max-lg:min-h-11 text-petrol-900 placeholder:font-normal placeholder:text-slate-400';

/**
 * Dados do desligamento no modo com dados reais. Começa vazio: nenhuma
 * data fictícia é usada. Os valores ficam só na memória da página.
 * Programado: com aviso e carta. Acidental (aba própria): sem aviso prévio;
 * os pontos afetados são mapeados igual e o registro entra no histórico.
 */
export default function OutageForm({
  form, view, onChange, defaultAudience,
}) {
  const accidental = form.type === 'acidental';
  const fields = accidental ? ACCIDENTAL_FIELDS : SCHEDULED_FIELDS;
  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="outage-title">
      <h2 id="outage-title" className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-[13.5px] font-semibold text-petrol-900">
        <Zap className={`h-4 w-4 ${accidental ? 'text-red-600' : 'text-petrol-500'}`} aria-hidden="true" />
        {accidental ? 'Ocorrência acidental' : 'Desligamento programado'}
      </h2>
      <div className="space-y-1.5 px-3.5 py-2.5">
        {fields.map((f) => (
          <label key={f.key} className="grid grid-cols-[96px_1fr] items-center gap-2 text-[12px] max-lg:grid-cols-[104px_minmax(0,1fr)] max-lg:text-[13.5px]">
            <span className="text-slate-500">{f.label}</span>
            {f.type === 'select' ? (
              <select value={form[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)} className={INPUT}>
                <option value="">Não informada</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type}
                value={form[f.key] ?? ''}
                placeholder={f.key === 'audience' ? (defaultAudience ?? '').toUpperCase() : f.placeholder}
                title={f.hint}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={INPUT}
              />
            )}
          </label>
        ))}
        <p className="text-[11px] leading-snug text-slate-500">
          {accidental
            ? `Sem aviso prévio. ${view.durationLabel ? `Duração: ${view.durationLabel}. ` : ''}Importe os pontos afetados para mapear as comunidades e registre no histórico.`
            : `Antecedência: ${view.noticeDaysBefore != null ? `${view.noticeDaysBefore} dia(s)` : 'não informada'}. Informe os dados da ordem oficial; campos vazios ficam como "não informado".`}
        </p>
        {view.problems.map((p) => (
          <p key={p} className="flex gap-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900" role="alert">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}
