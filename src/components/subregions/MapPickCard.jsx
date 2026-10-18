import { useState, useEffect } from 'react';
import {
  X, Plus, ChevronRight, Filter, Maximize2, Lock, Pencil, Shapes, Scissors,
} from 'lucide-react';
import RegionSummary from './RegionSummary.jsx';
import { LEVEL_LABEL } from '../../lib/ibgeHierarchy.js';
import { fmtArea } from '../../lib/customRegions.js';
import { isCommunity, confidenceReason } from '../../lib/communities.js';

const BTN = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-petrol-800 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-3';
const BTN_OUTLINE = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-3';
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-petrol-800 px-2.5 py-1.5 font-medium text-white hover:bg-petrol-700 disabled:opacity-50 max-lg:min-h-11 max-lg:px-3';
const INPUT = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-petrol-900 max-lg:min-h-11';
const EYEBROW = 'text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500';

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Row({ label, children }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 font-medium text-petrol-900">{children}</dd>
    </>
  );
}

/**
 * Cartão exibido ao clicar no mapa: a região sob o cursor (comunidade,
 * sub-região ou limite do IBGE), com abas para as outras camadas no mesmo ponto.
 */
export default function MapPickCard({
  pick, current, summary, place = null, canCreate, onSelect, onClose, onCreateHere, onDetails, onZoom, onFilterLayers,
  canEditCommunity = false, needsResponsible = false, onRename, onEditGeometry, onSplit, panelLabel = 'Sub-regiões',
}) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [by, setBy] = useState('');
  const rid = current?.region?.id ?? current?.region?.code;
  useEffect(() => { setRenaming(false); }, [rid]);
  if (!pick || !current) return null;
  const isCustom = current.kind === 'custom';
  const r = current.region;
  const community = isCustom && isCommunity(r);
  const low = community && r.confidence === 'baixa';
  const mun = place?.municipio ? `${place.municipio.nome}${place.municipio.uf ? `/${place.municipio.uf}` : ''}` : null;
  const kindLabel = community ? 'Comunidade' : isCustom ? 'Sub-região' : LEVEL_LABEL[r.level];
  const submitRename = (e) => {
    e.preventDefault();
    if (onRename?.(newName, needsResponsible ? by : undefined)) setRenaming(false);
  };
  return (
    <section className="pointer-events-auto w-[340px] overflow-hidden rounded-lg border border-slate-200 bg-white text-[12px] text-petrol-900 shadow-xl max-lg:w-full max-lg:text-[14px]" aria-label="Região selecionada">
      <header className="flex items-start gap-3 px-4 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-1.5 ${EYEBROW}`}>
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: isCustom ? r.color : '#94A3B8' }} aria-hidden="true" />
            {kindLabel}
            {!isCustom && <Lock className="h-3 w-3" aria-label="Limite oficial, somente leitura" />}
          </p>
          <h3 className="mt-1 truncate text-[15px] font-semibold leading-snug">{r.name}</h3>
          {(mun || !isCustom) && (
            <p className="truncate text-slate-500">{community ? mun : `Limite oficial IBGE · código ${r.code}`}</p>
          )}
        </div>
        <button type="button" onClick={onClose} className="-mr-1.5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-petrol-900 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </header>

      {pick.items.length > 1 && (
        <div className="flex gap-3 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] border-slate-200 px-3" role="tablist" aria-label="Camadas neste ponto">
          {pick.items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="tab"
              onClick={() => onSelect(i)}
              aria-selected={i === pick.index}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-1.5 py-2 font-medium max-lg:min-h-11 ${i === pick.index ? 'border-accent-500 text-petrol-900' : 'border-transparent text-slate-500 hover:text-petrol-800'}`}
            >
              {it.short}
            </button>
          ))}
        </div>
      )}

      <dl className={`grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 ${pick.items.length > 1 ? '' : 'border-t border-slate-200'}`}>
        {community && (
          <>
            {place?.distrito && <Row label="Distrito">{place.distrito.nome}{place.distrito.sede && <span className="font-normal text-slate-500"> (sede)</span>}</Row>}
            <Row label="Área">{fmtArea(r.areaKm2)}</Row>
            <Row label="Localização">
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${low ? 'bg-amber-500' : 'bg-emerald-600'}`} aria-hidden="true" />
                {low ? 'Aproximada' : 'Confiável'}
              </span>
              {low && <span className="block font-normal text-slate-500">{upperFirst(confidenceReason(r))}</span>}
            </Row>
            {r.metadata?.CONFIRMADO_EM && <Row label="Fontes"><span className="font-normal">{r.metadata.CONFIRMADO_EM}</span></Row>}
            {r.originalName && r.originalName !== r.name && <Row label="Nome original"><span className="font-normal">{r.originalName}</span></Row>}
          </>
        )}
        {isCustom && !community && <Row label="Área">{fmtArea(r.areaKm2)}</Row>}
        {!isCustom && (
          <>
            <Row label="Nível">{LEVEL_LABEL[r.level]}</Row>
            <Row label="Código IBGE"><span className="tabular-nums">{r.code}</span></Row>
          </>
        )}
      </dl>

      {isCustom && (
        <div className="border-t border-slate-200 px-4 py-3">
          <p className={`mb-1.5 ${EYEBROW}`}>Camadas na área</p>
          <RegionSummary summary={summary} compact />
        </div>
      )}

      {community && canEditCommunity && renaming && (
        <form onSubmit={submitRename} className="space-y-2 border-t border-slate-200 px-4 py-3">
          <label className="block font-medium text-petrol-900">
            Nome conhecido na região
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className={INPUT} autoFocus autoComplete="off" />
          </label>
          {needsResponsible && (
            <label className="block font-medium text-petrol-900">
              Responsável
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Nome ou matrícula" className={INPUT} autoComplete="off" />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setRenaming(false)} className={BTN_OUTLINE}>Cancelar</button>
            <button type="submit" disabled={!newName.trim() || newName.trim() === r.name} className={BTN_PRIMARY}>Salvar nome</button>
          </div>
        </form>
      )}

      <footer className="space-y-1 border-t border-slate-200 bg-slate-50 px-2 py-2">
        {community && canEditCommunity && !renaming && (
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 pb-1">
            <button type="button" onClick={() => { setNewName(r.name); setRenaming(true); }} className={BTN} title="Trocar pelo nome como a comunidade é conhecida">
              <Pencil className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Renomear
            </button>
            <button type="button" onClick={onEditGeometry} className={BTN} title="Aumentar ou diminuir a área; as vizinhas se ajustam junto">
              <Shapes className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Ajustar contorno
            </button>
            <button type="button" onClick={onSplit} className={BTN} title="Separar uma parte como comunidade nova">
              <Scissors className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Dividir
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-0.5">
          <button type="button" onClick={onZoom} className={BTN}>
            <Maximize2 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            Enquadrar
          </button>
          {isCustom && (
            <button type="button" onClick={onFilterLayers} className={BTN} title="Mostrar só o que está dentro desta área nas camadas de dados ativas">
              <Filter className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Filtrar camadas
            </button>
          )}
          <span className="ml-auto flex gap-1.5">
            {canCreate && (
              <button type="button" onClick={onCreateHere} className={BTN_OUTLINE}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Criar sub-região
              </button>
            )}
            <button type="button" onClick={onDetails} className={BTN_OUTLINE}>
              {isCustom ? 'Detalhes' : panelLabel}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      </footer>
    </section>
  );
}
