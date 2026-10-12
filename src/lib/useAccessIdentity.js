/**
 * Hook da identidade do Cloudflare Access (ver accessIdentity.js).
 *
 * A consulta é feita uma vez por carregamento da página e guardada só em
 * memória (variável do módulo). Nada vai para localStorage/sessionStorage.
 * Retorna { email, name } ou null (sem Access, ex.: npm run dev).
 */
import { useEffect, useState } from 'react';
import { fetchAccessIdentity } from './accessIdentity.js';

let pending = null;
let cached;

export function useAccessIdentity() {
  const [identity, setIdentity] = useState(cached ?? null);

  useEffect(() => {
    if (cached !== undefined) return undefined;
    let alive = true;
    pending ??= fetchAccessIdentity().then((id) => { cached = id; return id; });
    pending.then((id) => { if (alive) setIdentity(id); });
    return () => { alive = false; };
  }, []);

  return identity;
}
