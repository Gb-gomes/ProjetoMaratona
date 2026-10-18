import { Search, X, CheckSquare, Square } from 'lucide-react';

/** Texto sem acento e em minúsculas, para comparar nomes. */
export const foldName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * O que o filtro encontra em cada município:
 * - munMatch: o nome do município bate (o município inteiro entra);
 * - matches: comunidades cujo nome bate.
 * Sem texto, todos os municípios entram inteiros.
 */
export function matchCommunities(municipalities, query) {
  const q = foldName(query);
  return municipalities.map((m) => {
    if (!q) return { ...m, munMatch: true, matches: [] };
    return {
      ...m,
      munMatch: foldName(m.name).includes(q),
      matches: m.communities.filter((c) => foldName(c.name).includes(q)),
    };
  }).filter((m) => m.munMatch || m.matches.length);
}

/**
 * Ferramentas do grupo Comunidades no painel de camadas: filtro por nome
 * (município ou comunidade), marcar/desmarcar tudo (ou só o filtrado) e
 * contagem do que está no mapa. Desligar o que não interessa deixa o mapa mais leve.
 */
export default function CommunityLayerTools({
  query, onQuery, found, totals, onMarkAll, onUnmarkAll, showLabels = true, onShowLabels,
}) {
  const filtered = !!query.trim();
  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/80 p-2">
      <label className="relative block">
        <span className="sr-only">Filtrar por comunidade ou município</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filtrar comunidade ou município"
          className="block w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-7 text-[12.5px] text-petrol-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-200 max-lg:min-h-11 max-lg:text-[14px]"
          autoComplete="off"
        />
        {filtered && (
          <button type="button" onClick={() => onQuery('')} className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-slate-700" aria-label="Limpar filtro">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </label>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={onMarkAll}
          disabled={!found.length}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-100 disabled:opacity-50 max-lg:min-h-11 max-lg:text-[13px]"
        >
          <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {filtered ? 'Marcar filtrados' : 'Marcar todos'}
        </button>
        <button
          type="button"
          onClick={onUnmarkAll}
          disabled={!found.length}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-100 disabled:opacity-50 max-lg:min-h-11 max-lg:text-[13px]"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          {filtered ? 'Desmarcar filtrados' : 'Desmarcar todos'}
        </button>
      </div>
      {onShowLabels && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md px-0.5 py-0.5 text-[12.5px] text-petrol-900 max-lg:min-h-11 max-lg:text-[14px]">
          <input type="checkbox" checked={showLabels} onChange={(e) => onShowLabels(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent-500 max-lg:h-5 max-lg:w-5" />
          <span className="leading-snug">
            Mostrar nomes no mapa
            <span className="block text-[11px] text-slate-500">Sem nomes, o mapa fica mais leve; o contorno continua e o nome aparece ao passar o mouse ou clicar.</span>
          </span>
        </label>
      )}
      <p className="text-[11px] leading-snug text-slate-500">
        No mapa: <strong className="font-semibold text-petrol-800">{totals.munsOn}</strong> de {totals.muns} municípios,{' '}
        <strong className="font-semibold text-petrol-800">{totals.commsOn.toLocaleString('pt-BR')}</strong> de {totals.comms.toLocaleString('pt-BR')} comunidades.
        {filtered && ` Filtro: ${found.length} município(s).`}
        {!filtered && ' Desligue o que não precisa para o mapa ficar mais leve.'}
      </p>
    </div>
  );
}

/** Comunidades encontradas pelo filtro dentro de um município, cada uma com caixa de marcar. */
export function CommunityMatches({
  matches, isOn, onToggle, limit = 25,
}) {
  if (!matches.length) return null;
  return (
    <ul className="space-y-px border-l-2 border-slate-200 pl-2">
      {matches.slice(0, limit).map((c) => (
        <li key={c.id}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] text-petrol-900 hover:bg-slate-50 max-lg:min-h-11 max-lg:text-[14px]">
            <input type="checkbox" checked={isOn(c)} onChange={() => onToggle(c)} className="h-4 w-4 shrink-0 cursor-pointer accent-accent-500 max-lg:h-5 max-lg:w-5" />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {c.low && <span className="shrink-0 text-[10.5px] text-amber-700" title="Localização aproximada (confiança baixa)">aprox.</span>}
          </label>
        </li>
      ))}
      {matches.length > limit && <li className="px-1 text-[11px] text-slate-500">+{matches.length - limit} — refine o filtro</li>}
    </ul>
  );
}


