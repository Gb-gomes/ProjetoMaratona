/**
 * Tema claro/escuro.
 *
 * Preferência: 'light' | 'dark' | 'system' (padrão: segue o sistema
 * operacional). Fica salva neste navegador; é só uma conveniência visual.
 * O index.html aplica a mesma regra antes da primeira pintura, para evitar
 * que a tela "pisque" no tema errado.
 */
import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'conecta-rural:tema';
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function readThemePreference() {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const resolveTheme = (preference, systemDark) => (preference === 'system' ? (systemDark ? 'dark' : 'light') : preference);

function applyTheme(theme, { animate = false } = {}) {
  const root = document.documentElement;
  if (animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 250);
  }
  root.classList.toggle('dark', theme === 'dark');
}

/** @returns {{preference:string, theme:'light'|'dark', setPreference:(p:string)=>void}} */
export function useTheme() {
  const [preference, setPref] = useState(readThemePreference);
  const [systemDark, setSystemDark] = useState(() => !!media()?.matches);
  const theme = resolveTheme(preference, systemDark);

  useEffect(() => {
    const mq = media();
    if (!mq) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const setPreference = useCallback((p) => {
    try {
      if (p === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, p);
    } catch { /* conveniência apenas */ }
    applyTheme(resolveTheme(p, !!media()?.matches), { animate: true });
    setPref(p);
  }, []);

  return { preference, theme, setPreference };
}
