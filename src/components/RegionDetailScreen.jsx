import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, MapPinned, Pencil, Tractor, TriangleAlert,
} from 'lucide-react';
import {
  AnnounceControl, NameEditor, RealDetails, DemoDetails,
} from './RegionPanel.jsx';

/**
 * Detalhes de uma região em tela cheia (somente celular/tablet).
 * Reaproveita os mesmos blocos do painel do desktop: citação no aviso,
 * nomear/renomear e dados oficiais.
 */
export default function RegionDetailScreen({
  className = '', unit: u, index, isReal, title, speak, included, onToggleSelected,
  announce, announceThreshold, onAnnounceMode, history, result, layerInfo,
  operator, operatorLocked, onRenameRegion, onRemoveRegionName, onBack, onShowOnMap,
}) {
  const [editing, setEditing] = useState(false);
  const backRef = useRef(null);
  const number = String(index + 1).padStart(2, '0');
  const unnamed = isReal && !speak.name;
  const byProperty = announce?.mode === 'properties';
  const panelId = `unit-details-${u.id}`;

  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, [u.id]);
  useEffect(() => { setEditing(false); }, [u.id]);

  return (
    <section className={`flex flex-col rounded-md border border-slate-200 bg-white shadow-panel ${className}`} aria-labelledby="region-detail-title">
      <div className="sticky top-0 z-10 flex items-center gap-1 rounded-t-md border-b border-slate-200 bg-white px-1 py-1">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-[15px] font-medium text-petrol-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Regiões
        </button>
        <span className="ml-auto pr-2 text-[13px] text-slate-500">Região {number} de {String(result.units.length).padStart(2, '0')}</span>
      </div>

      <div className="space-y-4 px-3.5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-11 shrink-0 place-items-center rounded bg-petrol-800 text-[16px] font-semibold text-white">{number}</span>
          <div className="min-w-0 flex-1">
            <h2 id="region-detail-title" className={`break-words text-[18px] font-semibold leading-snug ${unnamed ? 'text-amber-700' : 'text-petrol-900'}`}>
              {title}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[14px] text-slate-600">
              {u.count} pontos | {u.pct.toLocaleString('pt-BR')}%
              {speak.origin === 'operator' && (
                <span className="rounded bg-petrol-50 px-1.5 py-px text-[12px] font-medium text-petrol-700 ring-1 ring-inset ring-petrol-100">nome alterado</span>
              )}
              {speak.origin === 'ibge' && (
                <span className="rounded bg-slate-100 px-1.5 py-px text-[12px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">nome IBGE</span>
              )}
            </p>
            {isReal && u.context?.length > 0 && (
              <p className="text-[13px] text-slate-500">{u.context.map((c) => c.value).join(' | ')}</p>
            )}
            {byProperty && (
              <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent-50 px-1.5 py-0.5 text-[12.5px] font-medium text-accent-800 ring-1 ring-inset ring-accent-200">
                <Tractor className="h-3.5 w-3.5" aria-hidden="true" />
                Aviso pelas propriedades | {announce.countLabel}
              </span>
            )}
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-slate-100" aria-hidden="true">
          <div className="h-full rounded bg-accent-400" style={{ width: `${u.pct}%` }} />
        </div>

        {unnamed && (
          <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900" role="status">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Região sem nome: ela aparece como pendência na carta até ser nomeada.
          </p>
        )}

        <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-[15px] font-medium ${
          included ? 'border-accent-300 bg-accent-50 text-petrol-900' : 'border-slate-300 text-petrol-800'
        }`}
        >
          <input type="checkbox" checked={included} onChange={onToggleSelected} className="h-6 w-6 shrink-0 accent-accent-500" />
          Incluir esta região no aviso
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onShowOnMap}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-petrol-700 px-3 text-[15px] font-semibold text-white hover:bg-petrol-800 ${isReal ? '' : 'col-span-2'}`}
          >
            <MapPinned className="h-5 w-5" aria-hidden="true" />
            Ver no mapa
          </button>
          {isReal && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-3 text-[15px] font-medium ${
                unnamed ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-petrol-700'
              }`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {speak.name ? 'Renomear' : 'Nomear'}
            </button>
          )}
        </div>

        {editing && (
          <NameEditor
            unit={u}
            currentName={speak.name}
            canRemove={speak.origin === 'operator'}
            operator={operator}
            operatorLocked={operatorLocked}
            onCancel={() => setEditing(false)}
            onSave={(data) => { if (onRenameRegion({ unit: u, ...data })) setEditing(false); }}
            onRemove={(by) => { if (onRemoveRegionName({ unit: u, by })) setEditing(false); }}
          />
        )}

        {announce && (
          <AnnounceControl item={announce} threshold={announceThreshold} onChange={onAnnounceMode} />
        )}

        <div>
          <h3 className="mb-1 text-[15px] font-semibold text-petrol-900">Dados da unidade</h3>
          {isReal
            ? <RealDetails u={u} speak={speak} history={history} result={result} layerInfo={layerInfo} panelId={panelId} />
            : <DemoDetails u={u} result={result} layerInfo={layerInfo} panelId={panelId} />}
        </div>
      </div>
    </section>
  );
}
