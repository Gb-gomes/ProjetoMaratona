import { useState } from 'react';
import {
  Layers, ChevronRight, ChevronDown, GripVertical, Plus, Maximize2, Settings2, ArrowUp, ArrowDown, Lock, Filter, LoaderCircle, Map as MapIcon,
} from 'lucide-react';
import LegendSwatch from './LegendSwatch.jsx';
import { siblingsOfNode } from '../../lib/layers/layerModel.js';

/**
 * Painel de camadas (modo real): mapa base, árvore de grupos e camadas,
 * ligar/desligar, arrastar para reordenar (ou setas), opacidade, zoom para
 * a camada, legenda automática e filtro por sub-região.
 * O que está mais acima no painel fica mais acima no mapa.
 */
export default function LayerPanel({
  tree, effective, basemaps, basemap, onBasemap, onToggle, onOpacity, onReorder, collapsed, onToggleCollapse,
  onZoomTo, onConfigure, onAddLayer, canUpload, regionsForFilter = [], onFilter, filterStatus = {}, extras = {}, className = '',
}) {
  const [open, setOpen] = useState({});
  const [drag, setDrag] = useState(null); // { id, overId }

  const toggleOpen = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const move = (id, delta) => {
    const sib = siblingsOfNode(tree, id);
    const i = sib.findIndex((n) => n.id === id);
    onReorder(id, sib, i + delta);
  };

  const dragProps = (node) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      setDrag({ id: node.id, overId: null });
    },
    onDragOver: (e) => {
      e.stopPropagation();
      if (!drag) return;
      const sib = siblingsOfNode(tree, drag.id);
      if (!sib.some((n) => n.id === node.id)) return; // só entre irmãos
      e.preventDefault();
      if (drag.overId !== node.id) setDrag((d) => ({ ...d, overId: node.id }));
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!drag) return;
      const sib = siblingsOfNode(tree, drag.id);
      const to = sib.findIndex((n) => n.id === node.id);
      if (to >= 0 && drag.id !== node.id) onReorder(drag.id, sib, to);
      setDrag(null);
    },
    onDragEnd: () => setDrag(null),
  });

  const renderLayer = (node, depth) => {
    const l = node.layer;
    const st = effective[l.id] ?? { visible: false, opacity: 1 };
    const expanded = !!open[l.id];
    const fs = filterStatus[l.id];
    const over = drag?.overId === l.id && drag.id !== l.id;
    return (
      <li key={l.id} className={`rounded ${over ? 'ring-2 ring-accent-400' : ''}`} {...dragProps(node)}>
        <div className="flex items-center gap-1 py-0.5 max-lg:min-h-11" style={{ paddingLeft: depth * 12 }}>
          <span className="cursor-grab text-slate-300 hover:text-slate-500 max-lg:hidden" title="Arraste para reordenar" aria-hidden="true">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <label className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[12.5px] max-lg:text-[14px] ${l.disabled ? 'cursor-not-allowed text-slate-400' : 'text-petrol-900'}`} title={l.disabledReason ?? undefined}>
            <input
              type="checkbox"
              checked={!l.disabled && st.visible}
              disabled={l.disabled}
              onChange={() => onToggle(l.id)}
              className="h-3.5 w-3.5 shrink-0 accent-accent-500 max-lg:h-5 max-lg:w-5"
            />
            {l.legend?.items?.length === 1 && <LegendSwatch {...l.legend.items[0]} size={14} />}
            <span className="min-w-0 flex-1 truncate leading-tight">
              {l.name}
              {l.subtitle && <span className="block truncate text-[10.5px] text-slate-500 max-lg:text-[12px]">{l.subtitle}</span>}
            </span>
            {l.readOnly && <Lock className="h-3 w-3 shrink-0 text-slate-400" aria-label="Somente leitura" />}
            {st.filterRegionId && <Filter className="h-3 w-3 shrink-0 text-accent-600" aria-label="Filtrada por sub-região" />}
          </label>
          <button
            type="button"
            onClick={() => toggleOpen(l.id)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Ocultar' : 'Mostrar'} opções de ${l.name}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 max-lg:h-11 max-lg:w-11"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
        {extras[l.id] && st.visible && <div className="ml-6">{extras[l.id]}</div>}
        {expanded && (
          <div className="mb-1.5 ml-6 mr-1 space-y-1.5 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11.5px] text-slate-600 max-lg:text-[13px]" style={{ marginLeft: depth * 12 + 24 }}>
            <label className="flex items-center gap-2">
              Opacidade
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={st.opacity}
                onChange={(e) => onOpacity(l.id, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent-500"
                aria-label={`Opacidade de ${l.name}`}
              />
              <span className="w-8 text-right tabular-nums">{Math.round(st.opacity * 100)}%</span>
            </label>
            {l.legend?.items?.length > 1 && (
              <div>
                {l.legend.title && <p className="font-medium text-petrol-800">{l.legend.title}</p>}
                <ul className="mt-0.5 space-y-0.5">
                  {l.legend.items.map((it, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={i} className="flex items-center gap-1.5"><LegendSwatch {...it} size={14} />{it.label}</li>
                  ))}
                </ul>
              </div>
            )}
            {l.canFilter && regionsForFilter.length > 0 && (
              <label className="flex items-center gap-2">
                <Filter className="h-3 w-3 shrink-0" aria-hidden="true" />
                <select
                  value={st.filterRegionId ?? ''}
                  onChange={(e) => onFilter(l.id, e.target.value || null)}
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11.5px] text-petrol-900 max-lg:min-h-11"
                  aria-label={`Filtrar ${l.name} por sub-região`}
                >
                  <option value="">Sem filtro (camada inteira)</option>
                  {regionsForFilter.map((r) => <option key={r.id} value={r.id}>Só dentro de: {r.name}</option>)}
                </select>
                {fs?.loading && <LoaderCircle className="h-3 w-3 animate-spin" aria-label="Filtrando" />}
              </label>
            )}
            {fs?.count != null && st.filterRegionId && <p>{fs.count.toLocaleString('pt-BR')} de {fs.total.toLocaleString('pt-BR')} feições dentro da sub-região.</p>}
            {l.info && <p className="leading-snug">{l.info}</p>}
            <div className="flex flex-wrap gap-1">
              {l.bounds && (
                <SmallButton onClick={() => onZoomTo(l)} icon={Maximize2}>Zoom para a camada</SmallButton>
              )}
              <SmallButton onClick={() => move(l.id, -1)} icon={ArrowUp} label="Subir">Subir</SmallButton>
              <SmallButton onClick={() => move(l.id, 1)} icon={ArrowDown} label="Descer">Descer</SmallButton>
              {l.canConfigure && <SmallButton onClick={() => onConfigure(l)} icon={Settings2}>{l.configureLabel ?? 'Configurar'}</SmallButton>}
            </div>
          </div>
        )}
      </li>
    );
  };

  const renderNode = (node, depth) => {
    if (node.type === 'layer') return renderLayer(node, depth);
    const g = node.group;
    const isCollapsed = !!collapsed[g.id];
    const over = drag?.overId === g.id && drag.id !== g.id;
    return (
      <li key={g.id} className={`rounded ${over ? 'ring-2 ring-accent-400' : ''}`} {...dragProps(node)}>
        <div className="flex items-center gap-1 pt-1.5" style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            onClick={() => onToggleCollapse(g.id)}
            aria-expanded={!isCollapsed}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 max-lg:min-h-11 max-lg:text-[12.5px]"
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{g.name}</span>
          </button>
          <span className="flex shrink-0 max-lg:hidden">
            <button type="button" onClick={() => move(g.id, -1)} className="rounded p-0.5 text-slate-300 hover:text-slate-600" aria-label={`Subir grupo ${g.name}`}><ArrowUp className="h-3 w-3" /></button>
            <button type="button" onClick={() => move(g.id, 1)} className="rounded p-0.5 text-slate-300 hover:text-slate-600" aria-label={`Descer grupo ${g.name}`}><ArrowDown className="h-3 w-3" /></button>
          </span>
        </div>
        {!isCollapsed && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
        {!isCollapsed && !node.children.length && <p className="py-1 text-[11px] text-slate-400" style={{ paddingLeft: depth * 12 + 20 }}>Grupo vazio</p>}
      </li>
    );
  };

  return (
    <section className={`flex w-[290px] flex-col rounded-md border border-slate-200 bg-white/95 shadow-md backdrop-blur-sm max-lg:w-[min(340px,calc(100vw-1.5rem))] ${className}`} aria-label="Camadas do mapa">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        <Layers className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />
        <h3 className="text-[12.5px] font-semibold text-petrol-900 max-lg:text-[14px]">Camadas</h3>
        {canUpload && (
          <button
            type="button"
            onClick={onAddLayer}
            className="ml-auto inline-flex items-center gap-1 rounded bg-petrol-800 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-petrol-700 max-lg:min-h-11 max-lg:px-3 max-lg:text-[13.5px]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Adicionar camada
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <fieldset className="pt-1.5">
          <legend className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 max-lg:text-[12.5px]">
            <MapIcon className="h-3 w-3" aria-hidden="true" />
            Mapa base
          </legend>
          <div className="mt-0.5 flex flex-wrap gap-x-3">
            {basemaps.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[12.5px] text-petrol-900 max-lg:min-h-11 max-lg:text-[14px]">
                <input type="radio" name="basemap" checked={basemap === b.id} onChange={() => onBasemap(b.id)} className="accent-accent-500 max-lg:h-5 max-lg:w-5" />
                {b.name.replace(/ \(.+\)$/, '')}
              </label>
            ))}
          </div>
        </fieldset>
        <ul>{tree.map((n) => renderNode(n, 0))}</ul>
      </div>
    </section>
  );
}

function SmallButton({
  onClick, icon: Icon, children, label,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-petrol-700 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-2.5 max-lg:text-[13px]"
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {children}
    </button>
  );
}
