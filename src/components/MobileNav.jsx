import {
  FileSpreadsheet, MapPinned, Map as MapIcon, Radio, ShieldAlert,
} from 'lucide-react';

export const MOBILE_TABS = [
  { id: 'dados', label: 'Dados', icon: FileSpreadsheet },
  { id: 'regioes', label: 'Regiões', icon: MapPinned },
  { id: 'mapa', label: 'Mapa', icon: MapIcon },
  { id: 'aviso', label: 'Aviso', icon: Radio },
  { id: 'alertas', label: 'Alertas', icon: ShieldAlert },
];

/**
 * Barra de abas fixa na parte inferior (somente abaixo de lg).
 * Fica fora da área rolável, então nunca cobre conteúdo; respeita a barra de gestos.
 * badges: { [tabId]: { count?: number, dot?: boolean, tone?: 'accent' | 'danger', label?: string } }
 */
export default function MobileNav({ active, onChange, badges = {} }) {
  return (
    <nav
      aria-label="Telas"
      className="shrink-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
    >
      <ul className="grid h-[var(--cr-nav-h)] grid-cols-5">
        {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
          const current = active === id;
          const b = badges[id];
          const badgeCls = b?.tone === 'danger' ? 'bg-red-600 text-white' : 'bg-accent-500 text-white';
          return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={current ? 'page' : undefined}
                aria-label={b?.label ? `${label} (${b.label})` : label}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${
                  current ? 'text-accent-700' : 'text-slate-500'
                }`}
              >
                <span className={`absolute inset-x-3 top-0 h-[3px] rounded-b ${current ? 'bg-accent-500' : 'bg-transparent'}`} aria-hidden="true" />
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
                  {b && (b.count > 0 || b.dot) && (
                    <span
                      className={`absolute grid place-items-center rounded-full font-semibold ring-2 ring-white ${badgeCls} ${
                        b.count > 0 ? '-right-2.5 -top-1.5 h-[18px] min-w-[18px] px-1 text-[11px] leading-[18px]' : '-right-1 -top-0.5 h-2.5 w-2.5'
                      }`}
                      aria-hidden="true"
                    >
                      {b.count > 0 ? (b.count > 99 ? '99+' : b.count) : ''}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
