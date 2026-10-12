/**
 * Identidade do usuário autenticado pelo Cloudflare Access.
 *
 * Em produção, o site fica atrás do Cloudflare Access, que expõe na própria
 * origem o endpoint /cdn-cgi/access/get-identity (compatível com a CSP
 * connect-src 'self'). Em desenvolvimento local o endpoint não existe: o Vite
 * devolve 404 ou o index.html, e a função retorna null.
 *
 * Regras:
 * - nunca lança erro para a interface (qualquer falha → null);
 * - não escreve no console;
 * - não grava nada no navegador: a identidade fica só em memória.
 *
 * É uma conveniência de front-end para auditoria; não substitui autorização
 * em backend. Ver docs/DEPLOY_CLOUDFLARE.md.
 */

export const ACCESS_IDENTITY_URL = '/cdn-cgi/access/get-identity';
export const ACCESS_LOGOUT_URL = '/cdn-cgi/access/logout';
export const DEFAULT_TIMEOUT_MS = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Extrai { email, name } de um objeto JSON; null se não houver e-mail válido. */
export function parseIdentity(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const email = clean(json.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  const name = clean(json.name).slice(0, 120) || null;
  return { email, name };
}

/**
 * Busca a identidade no Cloudflare Access.
 * @returns {Promise<{email: string, name: string|null} | null>}
 */
export async function fetchAccessIdentity({
  fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(null);
    }, timeoutMs);
  });

  const request = (async () => {
    try {
      const res = await fetchImpl(ACCESS_IDENTITY_URL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });
      if (!res || !res.ok) return null;
      const type = String(res.headers?.get?.('content-type') ?? '').toLowerCase();
      // Em desenvolvimento, o Vite responde com o index.html (text/html).
      if (!type.includes('json')) return null;
      const text = await res.text();
      return parseIdentity(JSON.parse(text));
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
