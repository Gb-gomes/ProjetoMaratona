import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchPlaces } from '../../lib/placeNames.js';
import { parseLatLngText, formatLatLng } from '../../lib/coords.js';

const KIND_TEXT = {
  comunidade: 'Comunidade', distrito: 'Distrito', municipio: 'Município', coordenada: 'Coordenada',
};

/**
 * Busca de lugares (comunidades, distritos, municípios), sem diferenciar
 * acentos e maiúsculas. Escolher um resultado enquadra o lugar no mapa.
 * Também aceita coordenada em graus decimais ("-21,3905, -42,5520"): o
 * resultado leva ao ponto e mostra a comunidade e a fazenda do lugar.
 */
export default function PlaceSearch({
  hierarchy, communities, onSelect, compact = false, autoFocus = false, onClose,
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const coord = useMemo(() => parseLatLngText(q), [q]);
  const results = useMemo(() => {
    if (coord && !coord.error) {
      return [{
        kind: 'coordenada',
        id: formatLatLng(coord.lat, coord.lng),
        nome: formatLatLng(coord.lat, coord.lng),
        detalhe: coord.swapped ? 'Coordenada (latitude e longitude estavam invertidas)' : 'Ir para a coordenada',
        lat: coord.lat,
        lng: coord.lng,
      }];
    }
    return coord?.error ? [] : searchPlaces(q, { hierarchy, communities });
  }, [q, coord, hierarchy, communities]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => setActive(0), [q]);

  const choose = (r) => {
    onSelect(r);
    setOpen(false);
    setQ(r.kind === 'coordenada' ? '' : r.nome);
    inputRef.current?.blur();
  };

  return (
    <div ref={boxRef} className={`relative ${compact ? 'w-full' : 'w-[230px]'}`}>
      <label className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
            if (e.key === 'Escape') { setOpen(false); onClose?.(); }
          }}
          placeholder="Comunidade, distrito ou lat, long…"
          aria-label="Buscar lugar"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="place-search-results"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-petrol-900 outline-none max-lg:text-[16px]"
          autoComplete="off"
        />
        {(q || onClose) && (
          <button type="button" onClick={() => { setQ(''); onClose?.(); }} className="text-slate-400 hover:text-slate-600 max-lg:grid max-lg:h-9 max-lg:w-9 max-lg:place-items-center" aria-label="Limpar busca">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
      {open && q.trim().length >= 2 && (
        <ul id="place-search-results" role="listbox" className="absolute left-0 right-0 top-full z-[1200] mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col px-3 py-1.5 text-left max-lg:min-h-11 ${i === active ? 'bg-slate-100' : ''}`}
              >
                <span className="text-[12.5px] font-medium text-petrol-900 max-lg:text-[14px]">
                  {r.nome}
                  {r.confianca === 'baixa' && <span className="ml-1 text-[11px] font-normal text-amber-700">≈ aproximada</span>}
                </span>
                <span className="text-[11px] text-slate-500 max-lg:text-[12.5px]">{r.detalhe ?? KIND_TEXT[r.kind]}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-2 text-[12px] text-slate-500">{coord?.error ?? 'Nenhum lugar encontrado.'}</li>}
        </ul>
      )}
    </div>
  );
}
