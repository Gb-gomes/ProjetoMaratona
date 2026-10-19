/**
 * Coordenada digitada → { lat, lng }.
 *
 * Aceita graus decimais com ponto ou vírgula, separados por espaço, vírgula
 * ou ponto e vírgula: "-21.3905, -42.5520", "-21,3905 -42,5520",
 * "-21,3905; -42,5520", "-21,3905,-42,5520".
 * Se os valores parecem invertidos (longitude primeiro), inverte e avisa.
 */
import { BRAZIL_BBOX } from './csv.js';

const NUM = '([-+−]?\\d+(?:[.,]\\d+)?)';
const PAIR = new RegExp(`^\\s*${NUM}\\s*(?:[;,]\\s*|\\s+)${NUM}\\s*$`);

const toNumber = (s) => Number(String(s).replace('−', '-').replace(',', '.'));
const inBrazil = (lat, lng) => lat >= BRAZIL_BBOX.minLat && lat <= BRAZIL_BBOX.maxLat
  && lng >= BRAZIL_BBOX.minLng && lng <= BRAZIL_BBOX.maxLng;

/**
 * @returns {{ lat, lng, swapped: boolean } | { error: string } | null}
 *   null = o texto não tem formato de coordenada (é um nome, por exemplo).
 */
export function parseLatLngText(text) {
  const m = PAIR.exec(String(text ?? ''));
  if (!m) return null;
  const a = toNumber(m[1]);
  const b = toNumber(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (inBrazil(a, b)) return { lat: a, lng: b, swapped: false };
  if (inBrazil(b, a)) return { lat: b, lng: a, swapped: true };
  return { error: 'Coordenada fora do Brasil. Use graus decimais, com sinal negativo (ex.: -21,3905, -42,5520).' };
}

/** "-21.39050, -42.55200" (5 casas ≈ 1 m). */
export const formatLatLng = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
