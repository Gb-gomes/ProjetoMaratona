import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, Database, CircleCheck, TriangleAlert, LoaderCircle, MapPinned, ListChecks, Pencil, Download, Upload, History,
  Tractor,
} from 'lucide-react';
import { resolveSpeakableName } from '../lib/communicationUtils.js';
import RegionDetailScreen from './RegionDetailScreen.jsx';

export function Detail({ label, children }) {
  return (
    <div className="contents">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-petrol-900 max-lg:min-w-0 max-lg:break-words">{children}</dd>
    </div>
  );
}

const ORIGIN_LABEL = {
  operator: 'nome definido pelo operador',
  correspondence: 'correspondência validada',
  official: 'nome oficial aprovado',
  ibge: 'nome automático da área do IBGE',
  comunidade: 'comunidades dos pontos afetados (arquivo de comunidades)',
  microrregiao: 'nome da microrregião (arquivo de comunidades)',
};
const ACTION_LABEL = {
  definido: 'Nome definido', alterado: 'Nome alterado', removido: 'Nome removido', importado: 'Nome importado',
};
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * Lista das unidades territoriais identificadas.
 * - Clicar no nome: foca a unidade no mapa e expande os detalhes.
 * - Caixa de seleção: inclui ou retira a unidade do aviso.
 * - Modo real: "Nomear" registra o nome pelo qual a comunidade conhece a região.
 */
export default function RegionPanel({
  mode = 'demo', phase, result, summary, focusId, onFocus, selectedIds, onToggleSelected, onSelectAll, onClearSelection,
  layerInfo, layerState, nameOptions, onOpenAudit,
  regionStore = {}, operator = '', operatorLocked = false, onRenameRegion, onRemoveRegionName, onExportNames, onImportNames,
  announcementByUnit = {}, announceThreshold = 3, onAnnounceMode,
  className = '', mobile = false, detailId = null, onOpenDetail, onCloseDetail, onShowOnMap,
}) {
  const done = phase === 'done' && result;
  const isReal = mode === 'real';
  const [editingId, setEditingId] = useState(null);
  const importRef = useRef(null);

  const speakOf = (u) => (isReal ? resolveSpeakableName(u, nameOptions) : { name: u.name, origin: null });
  const unitTitle = (u) => (isReal ? (speakOf(u).name ?? u.name ?? 'Região sem nome') : u.label);
  const savedCount = Object.values(regionStore).filter((e) => e.current).length;

  // Mantém o item em foco visível na lista (inclusive quando focado pelo mapa).
  // No computador a lista fica abaixo do mapa: rola só a lista, sem tirar o mapa da tela.
  const listRef = useRef(null);
  useEffect(() => {
    if (!focusId) return;
    const item = document.getElementById(`unit-${focusId}`);
    const box = listRef.current;
    if (!item) return;
    if (!mobile && box) {
      box.scrollTo({ top: item.offsetTop - 8, behavior: 'smooth' });
      return;
    }
    item.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusId, mobile]);

  useEffect(() => { if (!done) setEditingId(null); }, [done]);

  // Celular: os detalhes da região ocupam a tela inteira (com Voltar).
  const detailIndex = mobile && done && detailId ? result.units.findIndex((u) => u.id === detailId) : -1;
  if (detailIndex >= 0) {
    const u = result.units[detailIndex];
    return (
      <RegionDetailScreen
        className={className}
        unit={u}
        index={detailIndex}
        isReal={isReal}
        title={unitTitle(u)}
        speak={speakOf(u)}
        included={selectedIds.includes(u.id)}
        onToggleSelected={() => onToggleSelected(u.id)}
        announce={announcementByUnit[u.id]}
        announceThreshold={announceThreshold}
        onAnnounceMode={(m) => onAnnounceMode(u.id, m)}
        history={regionStore[u.code]?.history ?? []}
        result={result}
        layerInfo={layerInfo}
        operator={operator}
        operatorLocked={operatorLocked}
        onRenameRegion={onRenameRegion}
        onRemoveRegionName={onRemoveRegionName}
        onBack={onCloseDetail}
        onShowOnMap={() => onShowOnMap(u.id)}
      />
    );
  }

  return (
    <section className={`flex min-h-0 flex-col rounded-md border border-slate-200 bg-white shadow-panel ${className}`} aria-labelledby="regions-title">
      <div className="border-b border-slate-100 px-3.5 py-2.5">
        <h2 id="regions-title" className="text-[13.5px] font-semibold text-petrol-900 max-lg:text-[16px]">Regiões identificadas</h2>
        <p className="text-[12px] text-slate-500 max-lg:text-[13px]">
          <span className="max-lg:hidden">
            {done && result.grouping === 'place'
              ? 'Microrregiões com pontos afetados; pontos fora delas, pela área do IBGE'
              : 'Unidades territoriais associadas aos pontos importados'}
          </span>
          <span className="lg:hidden">Toque numa região para ver os detalhes. A caixa inclui a região no aviso.</span>
        </p>
      </div>

      {/* Status da camada usada */}
      <div className={`mx-3.5 mt-3 flex gap-2 rounded-md border px-2.5 py-2 text-[11.5px] leading-snug ${
        layerInfo.mode === 'demo' || layerInfo.mode === 'not-configured' || layerState?.status === 'error'
          ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}
      >
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">{layerInfo.title}</span>
          <br />
          {layerInfo.note}
          {isReal && layerState?.status === 'loaded' && (
            <span className="block">{layerState.layer.features.length} unidades carregadas | ano de referência {layerInfo.referenceYear}</span>
          )}
          {isReal && layerState?.status === 'error' && <span className="block font-medium">Erro: {layerState.errors[0]}</span>}
        </p>
      </div>

      {isReal && (
        <div className="mx-3.5 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-600">
          <span>{savedCount} nome(s) de região salvo(s) neste navegador</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onExportNames} disabled={!savedCount} className="inline-flex items-center gap-1 font-medium max-lg:min-h-11 max-lg:text-[13px] text-petrol-600 hover:underline disabled:text-slate-400 disabled:no-underline">
              <Download className="h-3 w-3" aria-hidden="true" />Exportar
            </button>
            <button type="button" onClick={() => importRef.current?.click()} className="inline-flex items-center gap-1 font-medium max-lg:min-h-11 max-lg:text-[13px] text-petrol-600 hover:underline">
              <Upload className="h-3 w-3" aria-hidden="true" />Importar
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Importar nomes de região (JSON)"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportNames(f); e.target.value = ''; }}
            />
          </span>
        </div>
      )}

      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto scroll-pt-2 px-3.5 py-3 lg:max-h-[560px]">
        {phase === 'processing' && (
          <p className="flex items-center gap-2 py-6 text-[12.5px] text-slate-600" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin text-accent-500" aria-hidden="true" />
            Identificando unidades territoriais…
          </p>
        )}

        {done && isReal && (summary.unmatched > 0 || summary.ambiguous > 0) && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p className="flex-1">
              {summary.unmatched} ponto(s) sem correspondência e {summary.ambiguous} ambíguo(s) não entram nas contagens abaixo.
              <button type="button" onClick={onOpenAudit} className="ml-1 inline-flex items-center gap-1 font-medium underline underline-offset-2 max-lg:min-h-11">
                <ListChecks className="h-3 w-3" aria-hidden="true" />Revisar
              </button>
            </p>
          </div>
        )}

        {done && result.units.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-slate-500">Nenhum ponto associado unicamente a uma unidade.</p>
        )}

        {(phase === 'idle' || phase === 'error') && (
          <div className="py-6 text-center">
            <MapPinned className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
            <p className="mt-2 text-[12.5px] text-slate-500">Nenhuma região identificada ainda.</p>
            <p className="text-[12px] text-slate-400">Processe as coordenadas para ver os resultados.</p>
          </div>
        )}

        {done && (
          <>
            <div className="mb-2 flex items-center justify-between text-[11.5px] text-slate-500 max-lg:text-[13px]">
              <span>No aviso</span>
              <span className="flex items-center gap-2">
                <button type="button" onClick={onSelectAll} className="font-medium text-petrol-600 hover:underline max-lg:min-h-11 max-lg:px-1">Selecionar todas</button>
                <span aria-hidden="true">|</span>
                <button type="button" onClick={onClearSelection} className="font-medium text-petrol-600 hover:underline max-lg:min-h-11 max-lg:px-1">Limpar</button>
              </span>
            </div>
            <ul className="space-y-2 max-lg:space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-2 lg:space-y-0 2xl:grid-cols-3">
              {result.units.map((u, i) => {
                const expanded = focusId === u.id;
                const included = selectedIds.includes(u.id);
                const panelId = `unit-details-${u.id}`;
                const speak = speakOf(u);
                const unnamed = isReal && !speak.name;
                const announce = announcementByUnit[u.id];
                const byProperty = announce?.mode === 'properties';
                const editing = editingId === u.id;
                return (
                  <li
                    key={u.id}
                    id={`unit-${u.id}`}
                    className={`rounded-md border transition-colors ${expanded ? 'lg:col-span-full' : ''} ${
                      expanded ? 'border-petrol-700 bg-petrol-50/60' : unnamed ? 'border-amber-300' : 'border-slate-200 hover:border-accent-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 px-2.5 py-2 max-lg:gap-1 max-lg:py-1.5 max-lg:pl-0.5">
                      <label className="contents max-lg:grid max-lg:shrink-0 max-lg:h-12 max-lg:w-11 max-lg:place-items-center">
                        <input
                          type="checkbox"
                          checked={included}
                          onChange={() => onToggleSelected(u.id)}
                          aria-label={`Incluir ${unitTitle(u)} no aviso`}
                          className="h-4 w-4 shrink-0 accent-accent-500 max-lg:h-6 max-lg:w-6"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => (mobile ? onOpenDetail(u.id) : onFocus(u.id))}
                        aria-expanded={mobile ? undefined : expanded}
                        aria-controls={mobile ? undefined : panelId}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left max-lg:min-h-12"
                      >
                        <span className={`grid h-6 w-7 shrink-0 place-items-center rounded text-[11.5px] font-semibold max-lg:h-8 max-lg:w-9 max-lg:text-[14px] ${
                          expanded ? 'bg-petrol-800 text-white' : 'bg-accent-100 text-accent-800'
                        }`}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[12.5px] font-semibold leading-snug max-lg:text-[15px] ${unnamed ? 'text-amber-700' : 'text-petrol-900'}`}>
                            {unitTitle(u)}
                            {speak.origin === 'operator' && (
                              <span className="ml-1.5 rounded bg-petrol-50 px-1 py-px align-middle text-[10px] font-medium text-petrol-700 ring-1 ring-inset ring-petrol-100">
                                nome alterado
                              </span>
                            )}
                            {speak.origin === 'comunidade' && (
                              <span className="ml-1.5 rounded bg-emerald-50 px-1 py-px align-middle text-[10px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                comunidades
                              </span>
                            )}
                            {u.kind === 'microrregiao' && speak.origin !== 'operator' && (
                              <span className="ml-1.5 rounded bg-emerald-50 px-1 py-px align-middle text-[10px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                microrregião
                              </span>
                            )}
                            {u.kind === 'microrregiao' && u.confianca === 'baixa' && (
                              <span className="ml-1.5 rounded bg-amber-50 px-1 py-px align-middle text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                                localização aproximada
                              </span>
                            )}
                            {speak.origin === 'ibge' && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1 py-px align-middle text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                nome IBGE
                              </span>
                            )}
                          </span>
                          <span className="block text-[11.5px] text-slate-500 max-lg:text-[13px]">
                            {isReal && u.context?.length > 0 && `${u.context.map((c) => c.value).join(' | ')} | `}
                            {u.count} pontos | {u.pct.toLocaleString('pt-BR')}%
                          </span>
                          {byProperty && (
                            <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-accent-50 px-1.5 py-px text-[10.5px] font-medium max-lg:text-[12px] text-accent-800 ring-1 ring-inset ring-accent-200">
                              <Tractor className="h-3 w-3" aria-hidden="true" />
                              Aviso pelas propriedades | {announce.countLabel}
                            </span>
                          )}
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform max-lg:h-5 max-lg:w-5 max-lg:-rotate-90 ${expanded && !mobile ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                      {isReal && (
                        <button
                          type="button"
                          onClick={() => setEditingId(editing ? null : u.id)}
                          className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium max-lg:min-h-11 max-lg:px-2.5 max-lg:text-[13px] ${
                            unnamed ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-slate-300 text-petrol-700 hover:bg-slate-50'
                          }`}
                          aria-label={`${speak.name ? 'Renomear' : 'Nomear'} região ${String(i + 1).padStart(2, '0')}`}
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                          {speak.name ? 'Renomear' : 'Nomear'}
                        </button>
                      )}
                    </div>
                    <div className="mx-2.5 mb-2 h-1 overflow-hidden rounded bg-slate-100" aria-hidden="true">
                      <div className="h-full rounded bg-accent-400" style={{ width: `${u.pct}%` }} />
                    </div>

                    {editing && !mobile && (
                      <NameEditor
                        unit={u}
                        currentName={speak.name}
                        canRemove={speak.origin === 'operator'}
                        operator={operator}
                        operatorLocked={operatorLocked}
                        onCancel={() => setEditingId(null)}
                        onSave={(data) => { if (onRenameRegion({ unit: u, ...data })) setEditingId(null); }}
                        onRemove={(by) => { if (onRemoveRegionName({ unit: u, by })) setEditingId(null); }}
                      />
                    )}

                    {expanded && !mobile && announce && (
                      <AnnounceControl
                        item={announce}
                        threshold={announceThreshold}
                        onChange={(mode) => onAnnounceMode(u.id, mode)}
                      />
                    )}
                    {expanded && !mobile && isReal && (
                      <RealDetails
                        u={u}
                        speak={speak}
                        history={regionStore[u.code]?.history ?? []}
                        result={result}
                        layerInfo={layerInfo}
                        panelId={panelId}
                      />
                    )}
                    {expanded && !mobile && !isReal && (
                      <DemoDetails u={u} result={result} layerInfo={layerInfo} panelId={panelId} />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Totais */}
      <div className="grid grid-cols-3 border-t border-slate-200 bg-slate-50 text-center">
        <div className="px-2 py-2">
          <p className="text-[16px] font-semibold text-petrol-900">{done ? summary.unitCount : '—'}</p>
          <p className="text-[11px] text-slate-500 max-lg:text-[12px]">regiões</p>
        </div>
        <div className="border-l border-slate-200 px-2 py-2">
          <p className="text-[16px] font-semibold text-petrol-900">{done ? summary.matched : '—'}</p>
          <p className="text-[11px] text-slate-500 max-lg:text-[12px]">pontos associados</p>
        </div>
        <div className="border-l border-slate-200 px-2 py-2">
          <p className="text-[16px] font-semibold text-accent-700">{done ? `${summary.selectedCount}/${summary.unitCount}` : '—'}</p>
          <p className="text-[11px] text-slate-500 max-lg:text-[12px]">{done ? `no aviso (${summary.selectedPoints} pts)` : 'no aviso'}</p>
        </div>
      </div>
    </section>
  );
}

/** Escolha de como a região é citada na carta (regra automática ou escolha do operador). */
export function AnnounceControl({ item, threshold, onChange }) {
  const options = [
    { value: 'auto', label: 'Automático', hint: `Propriedades se houver menos de ${threshold} clientes; senão, a região` },
    { value: 'region', label: 'Nome da região' },
    { value: 'properties', label: 'Nome das propriedades' },
  ];
  const current = item.automatic ? 'auto' : item.mode;
  return (
    <div className="mx-2.5 mb-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11.5px] max-lg:mx-0 max-lg:px-3 max-lg:py-3 max-lg:text-[14px]">
      <p className="font-semibold text-petrol-900">Como citar no aviso</p>
      <div role="radiogroup" aria-label="Como citar esta região no aviso" className="mt-1 flex flex-wrap gap-1 max-lg:gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={current === o.value}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded border px-2 py-0.5 font-medium max-lg:min-h-11 max-lg:flex-1 max-lg:px-2.5 ${
              current === o.value ? 'border-petrol-700 bg-petrol-700 text-white' : 'border-slate-300 bg-white text-petrol-800 hover:border-petrol-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-slate-600">
        {item.countLabel} afetado(s). Na carta: <span className="font-medium text-petrol-900">{item.lines.join('; ')}</span>
        {item.automatic && <span className="text-slate-500"> (regra automática)</span>}
      </p>
      {item.notes.map((n) => (
        <p key={n} className="mt-1 flex gap-1 text-amber-800">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {n}
        </p>
      ))}
    </div>
  );
}

/** Formulário para nomear/renomear uma região. */
export function NameEditor({
  unit, currentName, canRemove, operator, operatorLocked, onCancel, onSave, onRemove,
}) {
  const [name, setName] = useState(currentName ?? '');
  const [by, setBy] = useState(operator);
  const [note, setNote] = useState('');
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const submit = (e) => {
    e.preventDefault();
    onSave({ name, by, note });
  };
  const context = (unit.context ?? []).map((c) => c.value).join(' | ');

  return (
    <form onSubmit={submit} className="mx-2.5 mb-2 space-y-1.5 rounded-md border border-petrol-200 bg-white p-2.5 text-[11.5px] max-lg:mx-0 max-lg:space-y-2.5 max-lg:p-3 max-lg:text-[14px]">
      <p className="font-semibold text-petrol-900">
        {currentName ? 'Renomear região' : 'Nomear região'} {String(unit.order).padStart(2, '0')}
        {context && <span className="font-normal text-slate-500"> — {context} (IBGE)</span>}
      </p>
      <label className="block">
        <span className="text-slate-600">Nome conhecido pela comunidade *</span>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Ex.: Córrego Bela Vista"
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[12.5px] text-petrol-900 max-lg:min-h-11"
        />
      </label>
      <label className="block">
        <span className="text-slate-600">Responsável pela alteração *</span>
        {operatorLocked ? (
          <input
            value={operator}
            readOnly
            title="Identificado pelo login do Cloudflare Access"
            className="mt-0.5 w-full cursor-default rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[12.5px] text-petrol-800 max-lg:min-h-11"
          />
        ) : (
          <input
            value={by}
            onChange={(e) => setBy(e.target.value)}
            maxLength={80}
            placeholder="Nome e área"
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[12.5px] text-petrol-900 max-lg:min-h-11"
          />
        )}
      </label>
      <label className="block">
        <span className="text-slate-600">Observação (como o nome foi confirmado)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Ex.: confirmado com a equipe de campo"
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[12.5px] text-petrol-900 max-lg:min-h-11"
        />
      </label>
      <p className="text-[11px] leading-snug text-slate-500 max-lg:text-[13px]">
        O nome vale para esta região em todos os avisos e fica registrado no histórico com o responsável e a data.
      </p>
      <div className="flex flex-wrap gap-2 pt-0.5">
        <button type="submit" className="rounded-md bg-petrol-700 px-2.5 py-1 font-semibold text-white hover:bg-petrol-800 max-lg:min-h-11 max-lg:px-4">Salvar nome</button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-4">Cancelar</button>
        {canRemove && (
          <button type="button" onClick={() => onRemove(by)} className="ml-auto rounded-md border border-red-200 px-2.5 py-1 font-medium text-red-700 hover:bg-red-50 max-lg:min-h-11 max-lg:px-4">
            Remover nome
          </button>
        )}
      </div>
    </form>
  );
}

/** Detalhes de uma unidade da camada oficial (modo real). */
export function RealDetails({
  u, speak, history, result, layerInfo, panelId,
}) {
  const current = speak.origin === 'operator' ? speak.entry : null;
  if (u.kind === 'microrregiao' || u.kind === 'area_ibge') {
    return <PlaceDetails u={u} speak={speak} current={current} history={history} result={result} layerInfo={layerInfo} panelId={panelId} />;
  }
  return (
    <dl id={panelId} className="grid grid-cols-[104px_1fr] gap-x-2 gap-y-1 border-t border-slate-200 px-2.5 py-2 text-[11.5px] max-lg:grid-cols-[112px_minmax(0,1fr)] max-lg:gap-y-2 max-lg:px-0 max-lg:text-[14px]">
      <Detail label="Nome no aviso">
        {speak.name
          ? <>{speak.name} <span className="text-slate-500">({ORIGIN_LABEL[speak.origin]})</span></>
          : (
            <span className="inline-flex items-start gap-1 text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Sem nome e sem área do IBGE. Use &quot;Nomear&quot; para registrar o nome conhecido pela comunidade.
            </span>
          )}
        {current && (
          <span className="block text-slate-500">
            Alterado por {current.validatedBy} em {fmtDateTime(current.validatedOn)}
          </span>
        )}
        {speak.origin === 'ibge' && (
          <span className="block text-slate-500">Se a comunidade conhece a área por outro nome, use &quot;Nomear&quot;.</span>
        )}
      </Detail>
      {speak.origin === 'comunidade' && (
        <Detail label="Comunidades">
          {speak.communities.counts.map((c) => (
            <span key={c.id} className="block">
              {c.name}
              {' '}
              <span className="text-slate-500">({c.count} ponto(s){c.confianca === 'baixa' ? ', localização aproximada' : ''})</span>
            </span>
          ))}
          {speak.communities.uncovered > 0 && (
            <span className="block text-slate-500">{speak.communities.uncovered} ponto(s) fora das comunidades: citado(s) pelo nome do IBGE.</span>
          )}
        </Detail>
      )}
      <Detail label="Denominação IBGE">{u.name ?? <span className="text-slate-500">Sem denominação na camada oficial</span>}</Detail>
      {u.context?.map((c) => (
        <Detail key={c.label} label={`${c.label} (IBGE)`}>{c.value}</Detail>
      ))}
      <Detail label="Código oficial"><span className="font-mono">{u.code}</span></Detail>
      <Detail label="Tipo">{layerInfo.unitType}</Detail>
      <Detail label="Pontos">{u.count} de {result.matched} associados ({u.pct.toLocaleString('pt-BR')}%)</Detail>
      <Detail label="Fonte">{layerInfo.source}</Detail>
      <Detail label="Associação">
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Ponto no polígono, interior estrito
        </span>
      </Detail>
      {history.length > 0 && (
        <Detail label="Histórico">
          <details>
            <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-petrol-700 max-lg:min-h-11">
              <History className="h-3 w-3" aria-hidden="true" />{history.length} alteração(ões)
            </summary>
            <ol className="mt-1 space-y-1 border-l border-slate-200 pl-2">
              {[...history].reverse().map((h, k) => (
                <li key={`${h.at}-${k}`}>
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  {' — '}
                  {h.previousName ? `"${h.previousName}" → ` : ''}{h.name ? `"${h.name}"` : '(sem nome)'}
                  <span className="block text-slate-500">
                    {h.by}, {fmtDateTime(h.at)}{h.note ? ` — ${h.note}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </Detail>
      )}
    </dl>
  );
}

/** Detalhes de uma região por microrregião ou por área do IBGE (lib/placeRegions.js). */
function PlaceDetails({
  u, speak, current, history, result, layerInfo, panelId,
}) {
  const community = u.kind === 'microrregiao';
  const sectors = u.sectors ?? [];
  return (
    <dl id={panelId} className="grid grid-cols-[104px_1fr] gap-x-2 gap-y-1 border-t border-slate-200 px-2.5 py-2 text-[11.5px] max-lg:grid-cols-[112px_minmax(0,1fr)] max-lg:gap-y-2 max-lg:px-0 max-lg:text-[14px]">
      <Detail label="Nome no aviso">
        {speak.name} <span className="text-slate-500">({ORIGIN_LABEL[speak.origin]})</span>
        {current && (
          <span className="block text-slate-500">
            Alterado por {current.validatedBy} em {fmtDateTime(current.validatedOn)}. Nome no arquivo: {u.placeName}
          </span>
        )}
        {!community && speak.origin === 'ibge' && (
          <span className="block text-slate-500">Pontos fora das microrregiões. Se a comunidade conhece a área por outro nome, use &quot;Nomear&quot;.</span>
        )}
      </Detail>
      <Detail label="Tipo">{community ? 'Microrregião (arquivo de comunidades)' : 'Área do IBGE sem microrregião'}</Detail>
      {community && <Detail label="ID"><span className="font-mono">{u.externalCode}</span></Detail>}
      {community && (
        <Detail label="Confiança">
          {u.confianca === 'baixa'
            ? <span className="text-amber-700">Baixa: localização aproximada. Confirme com a equipe de campo.</span>
            : 'Boa'}
        </Detail>
      )}
      {u.context?.map((c) => (
        <Detail key={c.label} label={`${c.label} (IBGE)`}>{c.value}</Detail>
      ))}
      {!community && <Detail label="Código IBGE"><span className="font-mono">{u.code}</span></Detail>}
      <Detail label="Pontos">{u.count} de {result.matched} associados ({u.pct.toLocaleString('pt-BR')}%)</Detail>
      {community && u.nearCount > 0 && (
        <Detail label="Regra dos 100 m">{u.nearCount} ponto(s) numa lacuna entre microrregiões, atribuído(s) à mais próxima (até 100 m)</Detail>
      )}
      <Detail label={sectors.length > 1 ? 'Setores censitários' : 'Setor censitário'}>
        <span className="font-mono">{sectors.slice(0, 6).join(', ')}</span>
        {sectors.length > 6 && <span className="text-slate-500"> e mais {sectors.length - 6}</span>}
      </Detail>
      <Detail label="Fonte">{community ? 'Arquivo de comunidades do projeto (contorno aproximado, não oficial)' : 'IBGE: distritos e setores censitários'}</Detail>
      <Detail label="Associação">
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Ponto no polígono do {layerInfo.unitType.toLowerCase()}, interior estrito
        </span>
        <span className="block text-slate-500">
          {community ? 'Agrupado na microrregião que contém o ponto (ou na mais próxima, até 100 m).' : 'Fora de qualquer microrregião: agrupado pela área do IBGE.'}
        </span>
      </Detail>
      {history.length > 0 && (
        <Detail label="Histórico">
          <details>
            <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-petrol-700 max-lg:min-h-11">
              <History className="h-3 w-3" aria-hidden="true" />{history.length} alteração(ões)
            </summary>
            <ol className="mt-1 space-y-1 border-l border-slate-200 pl-2">
              {[...history].reverse().map((h, k) => (
                <li key={`${h.at}-${k}`}>
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  {' — '}
                  {h.previousName ? `"${h.previousName}" → ` : ''}{h.name ? `"${h.name}"` : '(sem nome)'}
                  <span className="block text-slate-500">
                    {h.by}, {fmtDateTime(h.at)}{h.note ? ` — ${h.note}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </Detail>
      )}
    </dl>
  );
}

/** Detalhes de uma unidade demonstrativa. */
export function DemoDetails({
  u, result, layerInfo, panelId,
}) {
  const geomOk = u.insideCount === u.count;
  return (
    <dl id={panelId} className="grid grid-cols-[104px_1fr] gap-x-2 gap-y-1 border-t border-slate-200 px-2.5 py-2 text-[11.5px] max-lg:grid-cols-[112px_minmax(0,1fr)] max-lg:gap-y-2 max-lg:px-0 max-lg:text-[14px]">
      <Detail label="Nome">{u.label}</Detail>
      <Detail label="Tipo">{layerInfo.unitType}</Detail>
      <Detail label="Código">{u.code}</Detail>
      <Detail label="Pontos">{u.count} de {result.total} ({u.pct.toLocaleString('pt-BR')}%)</Detail>
      <Detail label="Camada">{layerInfo.title} ({layerInfo.code})</Detail>
      <Detail label="Fonte">{layerInfo.source}</Detail>
      <Detail label="Correspondência">
        <span className={`inline-flex items-center gap-1 ${geomOk ? 'text-emerald-700' : 'text-amber-700'}`}>
          {geomOk ? <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />}
          {u.insideCount} de {u.count} pontos dentro do polígono
        </span>
        <span className="block text-slate-500">Associação predefinida, conferida por teste geométrico local.</span>
      </Detail>
    </dl>
  );
}
