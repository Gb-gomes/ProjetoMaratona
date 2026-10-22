import { CalendarClock, Zap } from 'lucide-react';

const TABS = [
  { value: 'programado', label: 'Desligamento programado', hint: 'Planejado, com aviso e carta', icon: CalendarClock },
  { value: 'acidental', label: 'Desligamento acidental', hint: 'Ocorrência sem aviso prévio', icon: Zap },
];

/** Abas do modo real: cada tipo de desligamento tem a sua importação e os seus dados. */
export default function OutageTabs({ value, onChange, disabled }) {
  return (
    <nav aria-label="Tipo de desligamento" className="px-3 pt-3 max-lg:pl-[max(0.75rem,env(safe-area-inset-left))] max-lg:pr-[max(0.75rem,env(safe-area-inset-right))]">
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-panel sm:inline-grid sm:w-auto">
        {TABS.map((t) => {
          const on = value === t.value;
          const accidental = t.value === 'acidental';
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={disabled && !on}
              onClick={() => onChange(t.value)}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 max-lg:min-h-11 ${on
                ? (accidental ? 'bg-red-600 text-white' : 'bg-petrol-700 text-white')
                : 'text-petrol-900 hover:bg-slate-50'}`}
            >
              <t.icon className={`h-4 w-4 shrink-0 ${on ? 'text-white' : accidental ? 'text-red-600' : 'text-petrol-500'}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">{t.label}</span>
                <span className={`block text-[11px] leading-tight max-sm:hidden ${on ? 'text-white/80' : 'text-slate-500'}`}>{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
