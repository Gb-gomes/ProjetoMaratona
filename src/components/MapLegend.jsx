/** Legenda flutuante do mapa. */
export default function MapLegend({ demo, layerInfo, showPriority = false }) {
  return (
    <div className="w-[236px] max-lg:w-[min(272px,calc(100vw-1.5rem))] rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 text-[12px] max-lg:text-[13.5px] text-petrol-900 shadow-md backdrop-blur-sm">
      <p className="mb-1.5 font-semibold">Legenda</p>
      <ul className="space-y-1 max-lg:space-y-1.5">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-white bg-petrol-800 ring-1 ring-petrol-800" aria-hidden="true" />
          {demo ? 'Registro geográfico importado' : 'Ponto importado'}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 rounded-sm border-[1.5px] border-accent-600 bg-accent-400/40" aria-hidden="true" />
          Unidade com pontos afetados
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 rounded-sm border-[1.5px] border-dashed border-accent-600 bg-accent-400/10" aria-hidden="true" />
          Unidade afetada fora do aviso
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 rounded-sm border border-dashed border-slate-400 bg-slate-200/60" aria-hidden="true" />
          Unidade sem pontos afetados
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 rounded-sm border-[2.5px] border-petrol-900 bg-accent-500/50" aria-hidden="true" />
          Unidade selecionada
        </li>
      </ul>
      {showPriority && (
        <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11.5px]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" aria-hidden="true" />A vital</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rotate-45 bg-violet-600" aria-hidden="true" />B produtiva</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-600">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-petrol-900" aria-hidden="true" />confirmada</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-amber-600" aria-hidden="true" />possível</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-dotted border-red-600" aria-hidden="true" />revisão</span>
          </p>
        </div>
      )}
      {demo && (
        <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] leading-snug text-slate-500">
          Visualização demonstrativa: os polígonos não são fronteiras oficiais.
        </p>
      )}
    </div>
  );
}
