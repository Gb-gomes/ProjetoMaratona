import { createContext, useEffect, useRef } from 'react';
import { Layers, X, ChevronUp } from 'lucide-react';

export const LAYERS_PANEL_ID = 'map-layers-panel';
/** Estado do painel visto pelos componentes do mapa (folga da câmera). */
export const MapChromeContext = createContext({ dockOpen: false, compact: false });
/** Folga da câmera no desktop: zoom à esquerda, painel (300 px) à direita quando aberto. */
export const desktopPadding = (dockOpen) => ({ paddingTopLeft: [56, 48], paddingBottomRight: [dockOpen ? 324 : 32, 32] });

/**
 * Painel único "Camadas e legenda" do mapa.
 * - Telas grandes: cartão recolhível no canto superior direito do mapa.
 * - Celular/tablet (layout com abas): folha que sobe da parte de baixo do mapa.
 * O botão que abre o painel no celular fica na fileira de botões do mapa (MapView).
 */
export default function MapLayersDock({
  open, onOpenChange, sheet = false, hidden = false, children,
}) {
  const closeRef = useRef(null);

  // Folha do celular: Esc fecha e o foco vai para o botão Fechar ao abrir.
  useEffect(() => {
    if (!sheet || !open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, open, onOpenChange]);

  if (hidden) return null;

  if (sheet) {
    if (!open) return null;
    return (
      <>
        <button type="button" className="absolute inset-0 z-[1000] cursor-default bg-black/30" aria-label="Fechar camadas e legenda" onClick={() => onOpenChange(false)} />
        <section
          id={LAYERS_PANEL_ID}
          role="dialog"
          aria-labelledby="map-layers-title"
          className="cr-sheet absolute inset-x-0 bottom-0 z-[1001] flex max-h-[78%] flex-col rounded-t-xl border-t border-slate-200 bg-white shadow-2xl"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
            <Layers className="h-4 w-4 text-petrol-500" aria-hidden="true" />
            <h3 id="map-layers-title" className="flex-1 text-[14px] font-semibold text-petrol-900">Camadas e legenda</h3>
            <button ref={closeRef} type="button" onClick={() => onOpenChange(false)} className="inline-flex min-h-11 items-center gap-1 rounded px-3 text-[14px] font-medium text-petrol-700">
              <X className="h-5 w-5" aria-hidden="true" />
              Fechar
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-[600] flex w-[340px] max-w-[calc(100%-1.5rem)] flex-col items-end">
      {open ? (
        <section
          id={LAYERS_PANEL_ID}
          aria-labelledby="map-layers-title"
          className="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-md backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 py-1.5 pl-3 pr-1.5">
            <Layers className="h-4 w-4 text-petrol-500" aria-hidden="true" />
            <h3 id="map-layers-title" className="flex-1 text-[13px] font-semibold text-petrol-900">Camadas e legenda</h3>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-expanded
              aria-controls={LAYERS_PANEL_ID}
              title="Recolher camadas e legenda"
              aria-label="Recolher camadas e legenda"
              className="grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-expanded={false}
          aria-controls={LAYERS_PANEL_ID}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-3 py-1.5 text-[13px] font-medium text-petrol-800 shadow-md backdrop-blur-sm hover:bg-slate-50"
        >
          <Layers className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          Camadas e legenda
        </button>
      )}
    </div>
  );
}
