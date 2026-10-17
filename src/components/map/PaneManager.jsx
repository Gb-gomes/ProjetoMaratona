import { useMap } from 'react-leaflet';

export const paneName = (layerId) => `cr-${String(layerId).replace(/[^a-z0-9-]/gi, '-')}`;

/**
 * Cria um pane do Leaflet por camada e aplica z-index (ordem do painel) e
 * opacidade. Roda durante a renderização para que os panes existam antes
 * de as camadas filhas serem adicionadas ao mapa.
 *
 * Panes sem feições interativas (limites, sub-regiões, dados em tiles)
 * recebem pointer-events: none: com o renderizador canvas, cada pane tem o
 * próprio <canvas>, e um canvas por cima engoliria os cliques e as dicas das
 * camadas de baixo.
 *
 * @param panes { [layerId]: { zIndex, opacity, passThrough } }
 */
export default function PaneManager({ panes }) {
  const map = useMap();
  Object.entries(panes).forEach(([id, { zIndex, opacity, passThrough }]) => {
    const name = paneName(id);
    const el = map.getPane(name) ?? map.createPane(name);
    el.style.zIndex = String(zIndex);
    el.style.opacity = String(opacity ?? 1);
    el.style.pointerEvents = passThrough ? 'none' : '';
  });
  return null;
}
