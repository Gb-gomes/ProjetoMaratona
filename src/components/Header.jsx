import { useEffect, useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import {
  FlaskConical, Database, Sun, Moon, Monitor, LogOut, Menu, X,
} from 'lucide-react';
import { ACCESS_LOGOUT_URL } from '../lib/accessIdentity.js';

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

/** Seletor de modo em tamanho de toque (menu do celular e tela Dados). */
export function ModeSwitch({ mode, onModeChange, modeLocked }) {
  return (
    <div role="radiogroup" aria-label="Modo de operação" className="grid grid-cols-2 rounded-md border border-slate-200 bg-slate-50 p-1">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          disabled={modeLocked}
          onClick={() => onModeChange?.(m.value)}
          className={`min-h-11 rounded px-2 text-[14px] font-medium leading-tight transition-colors disabled:cursor-not-allowed ${
            mode === m.value ? 'bg-white text-petrol-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Cabeçalho compacto (abaixo de lg): marca + menu com modo, tema e usuário. */
function MobileHeader({
  mode, onModeChange, modeLocked, themePreference, onThemeChange, identity,
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`relative ${open ? 'z-[1200]' : 'z-30'} shrink-0 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)] lg:hidden`}>
      <div className="flex h-14 items-center gap-2.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
        <BrandMark />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-[15px] font-semibold text-petrol-900">Conecta Rural</h1>
          <p className="truncate text-[12px] text-slate-500">{mode === 'demo' ? 'Demonstração' : 'Teste com dados reais'}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-petrol-800 hover:bg-slate-50"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <>
          <button type="button" aria-label="Fechar menu" className="fixed inset-0 top-[calc(3.5rem+env(safe-area-inset-top))] cursor-default bg-black/40" onClick={() => setOpen(false)} />
          <div id="mobile-menu" className="absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] space-y-4 overflow-y-auto border-b border-slate-200 bg-white px-[max(1rem,env(safe-area-inset-left))] py-4 shadow-lg">
            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-petrol-900">Modo de operação</p>
              <ModeSwitch mode={mode} onModeChange={(m) => { onModeChange?.(m); setOpen(false); }} modeLocked={modeLocked} />
              {modeLocked && <p className="mt-1 text-[13px] text-slate-500">Aguarde o fim do processamento para trocar de modo.</p>}
            </div>
            {onThemeChange && (
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-petrol-900">Tema</p>
                <div role="radiogroup" aria-label="Tema da interface" className="grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-1">
                  {THEMES.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={themePreference === value}
                      onClick={() => onThemeChange(value)}
                      className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded px-1 text-[13px] font-medium leading-tight ${
                        themePreference === value ? 'bg-white text-petrol-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label.replace('Tema ', '').replace(/^./, (c) => c.toUpperCase())}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'demo'
                ? <StatusBadge tone="neutral" icon={FlaskConical}>Ambiente de Demonstração</StatusBadge>
                : <StatusBadge tone="info" icon={Database}>Teste local — sem envio externo</StatusBadge>}
              <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                Sistema disponível
              </span>
            </div>
            <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-petrol-700 text-[12px] font-semibold uppercase text-white" aria-hidden="true">
                {identity ? identity.email.slice(0, 2) : 'OP'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-slate-500">{identity ? 'Conectado como' : 'Usuário'}</p>
                <p className="break-all text-[14px] font-medium text-petrol-800">{identity ? identity.email : 'Operador COP'}</p>
              </div>
              {identity && (
                <a
                  href={ACCESS_LOGOUT_URL}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-[14px] font-medium text-petrol-700"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sair
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}

export default function Header(props) {
  return (
    <>
      <MobileHeader {...props} />
      <DesktopHeader {...props} />
    </>
  );
}

function DesktopHeader({
  mode = 'demo', onModeChange, modeLocked, themePreference = 'system', onThemeChange, identity = null,
}) {
  return (
    <header className="max-lg:hidden sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark />
        <div className="min-w-0 leading-tight">
          <h1 className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-petrol-900">
            Conecta Rural
            <span className="h-3.5 w-px bg-slate-300 max-xl:hidden" aria-hidden="true" />
            <span className="text-[13px] font-medium tracking-normal text-slate-500 max-xl:hidden">Inteligência Geográfica</span>
          </h1>
          <p className="truncate text-[12px] text-slate-500">Comunicação de desligamentos programados</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:ml-auto xl:gap-4">
        <div role="radiogroup" aria-label="Modo de operação" className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              disabled={modeLocked}
              onClick={() => onModeChange?.(m.value)}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed ${
                mode === m.value ? 'bg-white text-petrol-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-petrol-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {onThemeChange && <ThemeSwitch preference={themePreference} onChange={onThemeChange} />}
        {/* Abaixo de 1280 px o seletor de modo já diz o ambiente; o selo e o estado do sistema saem para caber. */}
        <span className="max-xl:hidden">
          {mode === 'demo'
            ? <StatusBadge tone="neutral" icon={FlaskConical}>Ambiente de Demonstração</StatusBadge>
            : <StatusBadge tone="info" icon={Database}>Teste local — sem envio externo</StatusBadge>}
        </span>
        <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600 xl:inline-flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Sistema disponível
        </span>
        {identity ? (
          // Usuário autenticado pelo Cloudflare Access (somente em memória; ver src/lib/accessIdentity.js).
          <div className="flex min-w-0 items-center gap-2 border-l border-slate-200 pl-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-700 text-[12px] font-semibold uppercase text-white" aria-hidden="true">
              {identity.email.slice(0, 2)}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="sr-only">Conectado como</p>
              <p className="hidden max-w-[220px] truncate text-[13px] font-medium text-petrol-800 sm:block" title={identity.email}>
                {identity.email}
              </p>
              <a
                href={ACCESS_LOGOUT_URL}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-petrol-600 underline-offset-2 hover:underline"
              >
                <LogOut className="h-3 w-3" aria-hidden="true" />
                Sair
              </a>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3 xl:pl-4">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-petrol-700 text-[12px] font-semibold text-white" aria-hidden="true">
              OP
            </span>
            <span className="sr-only xl:not-sr-only xl:whitespace-nowrap xl:text-[13px] xl:font-medium xl:text-petrol-800">Operador COP</span>
          </div>
        )}
      </div>
    </header>
  );
}
