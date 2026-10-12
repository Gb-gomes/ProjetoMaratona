import { useEffect, useState } from 'react';

/**
 * Layout de celular/tablet: abaixo do breakpoint `lg` do Tailwind (1024 px).
 * Só decide a apresentação (abas, telas cheias); nenhuma regra de negócio depende disto.
 */
export const MOBILE_QUERY = '(max-width: 1023.98px)';

const matches = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches;

export function useIsMobile() {
  const [mobile, setMobile] = useState(matches);
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY);
    if (!mq) return undefined;
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
