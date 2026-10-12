/**
 * As cores usadas pela interface são variáveis CSS (src/theme.css), com um
 * conjunto de valores para o modo claro e outro para o escuro (classe
 * `dark` no <html>). Assim os componentes não precisam de variantes `dark:`:
 * `bg-white`, `text-petrol-900` etc. trocam de valor junto com o tema.
 *
 * Convenção no modo escuro: `white` é a "superfície" (painéis) e também a
 * cor de contraste sobre botões fortes; as escalas se invertem (50 = fundo
 * sutil escuro, 900 = texto claro).
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const scale = (name) => Object.fromEntries(
  SHADES.map((s) => [s, `rgb(var(--c-${name}-${s}) / <alpha-value>)`]),
);

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--c-white) / <alpha-value>)',
        slate: scale('slate'),
        // Azul-petróleo: textos e elementos estruturais
        petrol: scale('petrol'),
        // Laranja: ações principais e regiões afetadas
        accent: scale('accent'),
        emerald: scale('emerald'),
        amber: scale('amber'),
        red: scale('red'),
        // Categoria B dos pontos prioritários (atividade produtiva crítica)
        violet: scale('violet'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
      },
    },
  },
  plugins: [],
};
