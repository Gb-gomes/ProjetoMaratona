import StatusBadge from './StatusBadge.jsx';
import {
  FlaskConical, Database, Sun, Moon, Monitor,
} from 'lucide-react';

/** Símbolo próprio do Conecta Rural: marcador de localização com raio. */
function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#112F44" />
      <path d="M16 5.5c-4.4 0-8 3.4-8 7.7 0 5.6 8 13.3 8 13.3s8-7.7 8-13.3c0-4.3-3.6-7.7-8-7.7z" fill="#EE7A12" />
      <path d="M17.2 8.6 12.6 14.4h3.1l-.9 4.9 4.6-5.9h-3.1z" fill="#fff" />
    </svg>
  );
}

const MODES = [
  { value: 'demo', label: 'Demonstração' },
  { value: 'real', label: 'Teste com dados reais' },
];

const THEMES = [
  { value: 'light', label: 'Tema claro', icon: Sun },
  { value: 'dark', label: 'Tema escuro', icon: Moon },
  { value: 'system', label: 'Seguir o sistema', icon: Monitor },
];

function ThemeSwitch({ preference, onChange }) {
  return (
    <div role="radiogroup" aria-label="Tema da interface" className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
          className={`grid h-7 w-7 place-items-center rounded transition-colors ${
            preference === value ? 'bg-white text-petrol-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-petrol-800'
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export default function Header({
  mode = 'demo', onModeChange, modeLocked, themePreference = 'system', onThemeChange,
}) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
      <div className="flex items-center gap-3">
        <BrandMark />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-petrol-900">
            Conecta Rural <span className="font-normal text-petrol-500">| Inteligência Geográfica</span>
          </p>
          <p className="text-[12px] text-slate-500">Comunicação de desligamentos programados</p>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:ml-auto">
        <div role="radiogroup" aria-label="Modo de operação" className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              disabled={modeLocked}
              onClick={() => onModeChange?.(m.value)}
              className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed ${
                mode === m.value ? 'bg-white text-petrol-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-petrol-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {onThemeChange && <ThemeSwitch preference={themePreference} onChange={onThemeChange} />}
        {mode === 'demo'
          ? <StatusBadge tone="neutral" icon={FlaskConical}>Ambiente de Demonstração</StatusBadge>
          : <StatusBadge tone="info" icon={Database}>Teste local — sem envio externo</StatusBadge>}
        <span className="hidden items-center gap-1.5 text-[12px] text-slate-600 md:inline-flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Sistema disponível
        </span>
        <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-petrol-700 text-[12px] font-semibold text-white" aria-hidden="true">
            OP
          </span>
          <span className="hidden text-[12.5px] font-medium text-petrol-800 sm:inline">Operador COP</span>
        </div>
      </div>
    </header>
  );
}
