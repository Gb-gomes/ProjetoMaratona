import { useRef, useState } from 'react';
import {
  PenTool, Square, MousePointerClick, FileUp, X, Save, TriangleAlert, CircleCheck, LoaderCircle, Eraser, Info, Pencil,
} from 'lucide-react';
import { REGION_COLORS, fmtArea } from '../../lib/customRegions.js';

const METHODS = [
  { id: 'drawn', label: 'Desenhar no mapa', hint: 'Polígono livre ou retângulo, com ajuste de vértices e encaixe nas bordas.', icon: PenTool },
  { id: 'units', label: 'Selecionar no mapa', hint: '', icon: MousePointerClick },
  { id: 'imported', label: 'Importar arquivo', hint: 'GeoJSON, KML/KMZ ou Shapefile (.zip).', icon: FileUp },
];

/**
 * Painel do editor de sub-região (flutua sobre o mapa).
 * Fluxo: método → desenho/seleção/importação → nome e detalhes → salvar,
 * com validação em tempo real (contenção, sobreposição, nome duplicado).
 */
export default function SubRegionEditorPanel({
  editor, validation, validating, parentLabel, unitsLabel, onMethod, onTool, onClear, onField, onImportFile, onSave, onCancel, saving,
  responsible = null, compact = false,
}) {
  const fileRef = useRef(null);
  // Celular: campos secundários recolhidos, para sobrar mapa para desenhar.
  const [more, setMore] = useState(!compact);
  const editingGeometry = editor.mode === 'edit-geometry';
  const splitting = editor.mode === 'split';
  const title = editingGeometry ? `Editar área: ${editor.form.name}` : splitting ? `Dividir comunidade: ${editor.form.splitOf}` : editor.form.duplicatedFrom ? 'Duplicar sub-região' : 'Nova sub-região';
  const v = validation;
  const errors = v ? Object.values(v.errors) : [];
  const unitMethod = editor.method === 'municipalities' || editor.method === 'sectors';

  return (
    <section className="pointer-events-auto flex min-h-0 max-h-full w-[340px] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl max-lg:max-h-[48dvh] max-lg:w-full max-lg:rounded-b-none" aria-labelledby="editor-title">
      <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h3 id="editor-title" className="truncate text-[14px] font-semibold text-petrol-900 max-lg:text-[15px]">{title}</h3>
          <p className="truncate text-[12px] text-slate-500 max-lg:text-[13px]">Dentro de: {parentLabel}</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center" aria-label="Cancelar edição">
          <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-[13px] text-petrol-900 max-lg:text-[14px]">
        {splitting && (
          <p className="text-[12px] leading-snug text-slate-600 max-lg:text-[13px]">Desenhe a parte que vira uma comunidade nova. A comunidade original fica com o restante; as duas guardam o histórico.</p>
        )}
        {!editingGeometry && (
          <div role="radiogroup" aria-label="Forma de criação" className="grid grid-cols-3 gap-1.5">
            {METHODS.map((m) => {
              const active = m.id === 'units' ? unitMethod : editor.method === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => (m.id === 'imported' ? fileRef.current?.click() : onMethod(m.id))}
                  title={m.id === 'units' ? `Clique nos ${unitsLabel} que formam a sub-região.` : m.hint}
                  className={`flex flex-col items-center gap-1 rounded border px-1 py-2 text-center text-[12px] font-medium leading-tight max-lg:min-h-16 max-lg:text-[13px] ${
                    active ? 'border-accent-500 bg-accent-50 text-accent-800' : 'border-slate-200 text-petrol-800 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {m.id === 'units' ? `Selecionar ${unitsLabel}` : m.label}
                </button>
              );
            })}
            <input
              ref={fileRef}
              type="file"
              accept=".geojson,.json,.kml,.kmz,.zip"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportFile(f); }}
            />
          </div>
        )}

        {(editor.method === 'drawn' || editor.method === 'imported') && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              <ToolButton active={editor.tool === 'polygon'} onClick={() => onTool('polygon')} icon={PenTool}>Polígono</ToolButton>
              <ToolButton active={editor.tool === 'rectangle'} onClick={() => onTool('rectangle')} icon={Square}>Retângulo</ToolButton>
              {editor.geometry && <ToolButton onClick={onClear} icon={Eraser}>Limpar</ToolButton>}
            </div>
            <p className="flex gap-1.5 text-[12px] leading-snug text-slate-600 max-lg:text-[13px]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {editor.tool === 'polygon' && 'Clique para adicionar vértices; clique no primeiro vértice para fechar. O cursor encaixa nas bordas próximas.'}
              {editor.tool === 'rectangle' && 'Clique e arraste para desenhar o retângulo.'}
              {!editor.tool && editor.geometry && 'Arraste os vértices para ajustar; clique no meio de uma aresta para criar um vértice; clique com o botão direito num vértice para removê-lo.'}
              {!editor.tool && !editor.geometry && 'Escolha Polígono ou Retângulo para começar.'}
            </p>
            {editor.sourceFile && <p className="text-[12px] text-slate-500"><Pencil className="inline h-3 w-3" aria-hidden="true" /> Importado de {editor.sourceFile}</p>}
          </div>
        )}
        {unitMethod && (
          <p className="flex gap-1.5 text-[12px] leading-snug text-slate-600 max-lg:text-[13px]">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Clique nos {unitsLabel} para incluir ou retirar. {editor.selection.length} selecionado(s).
            {editor.selection.length > 0 && <button type="button" onClick={onClear} className="ml-1 underline">Limpar</button>}
          </p>
        )}

        {editor.method && (
          <div className="space-y-2">
            {responsible}
            <label className="block">
              <span className="text-slate-600">Nome *</span>
              <input
                value={editor.form.name}
                onChange={(e) => onField('name', e.target.value)}
                disabled={editingGeometry}
                maxLength={80}
                aria-invalid={!!v?.errors.name}
                className={`mt-0.5 block w-full rounded border bg-white px-2 py-1 max-lg:min-h-11 ${v?.errors.name ? 'border-red-400' : 'border-slate-300'} disabled:bg-slate-50`}
                placeholder={splitting ? 'Nome da nova comunidade' : 'Ex.: Zona rural Norte'}
              />
            </label>
            {!editingGeometry && compact && (
              <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="min-h-11 text-[14px] font-medium text-petrol-700 underline">
                {more ? 'Menos detalhes' : 'Mais detalhes (descrição, cor, código, tags)'}
              </button>
            )}
            {!editingGeometry && more && (
              <>
                <label className="block">
                  <span className="text-slate-600">Descrição</span>
                  <textarea value={editor.form.description} onChange={(e) => onField('description', e.target.value)} rows={2} maxLength={1000} className="mt-0.5 block w-full resize-y rounded border border-slate-300 bg-white px-2 py-1" />
                </label>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <span className="text-slate-600">Cor</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {REGION_COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => onField('color', c)} aria-label={`Cor ${c}`} aria-pressed={editor.form.color === c} className={`h-6 w-6 rounded-full border-2 max-lg:h-9 max-lg:w-9 ${editor.form.color === c ? 'border-petrol-900' : 'border-white ring-1 ring-slate-200'}`} style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                </div>
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-petrol-700 max-lg:min-h-11 max-lg:py-2">Código interno e tags</summary>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <label className="block"><span className="text-slate-600">Código interno</span><input value={editor.form.internalCode} onChange={(e) => onField('internalCode', e.target.value)} maxLength={40} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" /></label>
                    <label className="block"><span className="text-slate-600">Tags (vírgula)</span><input value={editor.form.tags} onChange={(e) => onField('tags', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" /></label>
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {editor.method && (
          <div className="space-y-1" aria-live="polite">
            {validating && <p className="flex items-center gap-1.5 text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Validando…</p>}
            {!validating && v?.prepared && !v.prepared.empty && (
              <p className="text-slate-600">
                Área: <strong>{fmtArea(v.prepared.geometry ? v.metrics.areaKm2 : 0)}</strong> · perímetro {v.metrics.perimeterKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km
              </p>
            )}
            {!validating && v?.warnings.map((w) => (
              <p key={w} className="flex gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{w}</p>
            ))}
            {!validating && v?.prepared?.clipped && !v.prepared.beyondTolerance && (
              <p className="text-[12px] text-slate-500">Pequenas sobras além da borda (até {Math.round(v.prepared.maxOutsideMeters)} m, dentro da tolerância) serão recortadas.</p>
            )}
            {!validating && errors.filter((e) => e !== v.errors.geometry || editor.geometry).map((e) => (
              <p key={e} className="flex gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-800" role="alert"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{e}</p>
            ))}
            {!validating && v?.ok && <p className="flex items-center gap-1.5 text-emerald-700"><CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />Pronta para salvar.</p>}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-petrol-800 max-lg:min-h-11 max-lg:flex-1 max-lg:text-[14px]">Cancelar</button>
        <button
          type="button"
          onClick={onSave}
          disabled={!v?.ok || validating || saving}
          className="ml-auto inline-flex items-center gap-1.5 rounded bg-accent-500 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-600 disabled:opacity-40 max-lg:min-h-11 max-lg:flex-1 max-lg:justify-center max-lg:text-[14px]"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {editingGeometry ? 'Salvar área' : splitting ? 'Dividir' : 'Salvar sub-região'}
        </button>
      </div>
    </section>
  );
}

function ToolButton({
  active, onClick, icon: Icon, children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ?? undefined}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[12px] font-medium max-lg:min-h-11 max-lg:px-3 max-lg:text-[14px] ${active ? 'border-accent-500 bg-accent-500 text-white' : 'border-slate-300 bg-white text-petrol-800 hover:bg-slate-50'}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}
