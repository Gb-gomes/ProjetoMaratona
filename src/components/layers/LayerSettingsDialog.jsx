import { useEffect, useRef, useState } from 'react';
import {
  X, Settings2, Palette, Info, History, Share2, Trash2, LoaderCircle, RefreshCw, Plus,
} from 'lucide-react';
import LegendSwatch from './LegendSwatch.jsx';
import {
  SYMBOLS, VISIBILITY, legendFor, categorizedRule, graduatedRule,
} from '../../lib/layers/layerModel.js';
import { request } from '../../lib/layers/workerClient.js';

const fmt = (n) => Number(n ?? 0).toLocaleString('pt-BR');
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
const TABS = [
  ['style', 'Estilo', Palette], ['info', 'Informações', Info], ['versions', 'Versões', History], ['share', 'Compartilhamento', Share2],
];

/** Configuração de uma camada de dados ou externa (estilo, metadados, versões, compartilhamento). */
export default function LayerSettingsDialog({
  layer, groupPath, groupPaths = [], canEdit, onClose, onSave, onUpdateData, onRemoveVersion, onDelete,
}) {
  const [tab, setTab] = useState(layer?.kind === 'external' ? 'info' : 'style');
  const ref = useRef(null);
  useEffect(() => {
    if (!layer) return undefined;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layer, onClose]);
  if (!layer) return null;
  const tabs = layer.kind === 'external' ? TABS.filter(([id]) => id === 'info' || id === 'share') : TABS;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 max-lg:p-0">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="layer-settings-title" className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-md bg-white shadow-2xl outline-none max-lg:h-[100dvh] max-lg:max-h-none max-lg:rounded-none">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Settings2 className="h-4 w-4 text-petrol-500" aria-hidden="true" />
          <h2 id="layer-settings-title" className="min-w-0 flex-1 truncate text-[14px] font-semibold text-petrol-900 max-lg:text-[15px]">{layer.name}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px]" aria-label="Fechar">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-1.5" role="tablist">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium max-lg:min-h-11 max-lg:text-[14px] ${tab === id ? 'border-accent-500 text-petrol-900' : 'border-transparent text-slate-500'}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12.5px] text-petrol-900 max-lg:text-[14px]">
          {!canEdit && <p className="mb-2 rounded bg-slate-50 px-2 py-1 text-slate-600">Somente leitura para o seu papel.</p>}
          {tab === 'style' && <StyleTab layer={layer} canEdit={canEdit} onSave={onSave} />}
          {tab === 'info' && <InfoTab layer={layer} groupPath={groupPath} groupPaths={groupPaths} canEdit={canEdit} onSave={onSave} onDelete={onDelete} />}
          {tab === 'versions' && <VersionsTab layer={layer} canEdit={canEdit} onUpdateData={onUpdateData} onRemoveVersion={onRemoveVersion} />}
          {tab === 'share' && <ShareTab layer={layer} canEdit={canEdit} onSave={onSave} />}
        </div>
      </div>
    </div>
  );
}

const input = 'mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11';

function StyleTab({ layer, canEdit, onSave }) {
  const [style, setStyle] = useState(layer.style);
  const [ruleType, setRuleType] = useState(layer.style.rule?.type ?? 'simple');
  const [field, setField] = useState(layer.style.rule?.field ?? '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState({ min: layer.minZoom ?? '', max: layer.maxZoom ?? '' });
  const fam = layer.geometryType;
  const attrs = layer.attributesSchema ?? [];
  const set = (k, v) => setStyle((s) => ({ ...s, [k]: v }));

  const generate = async (type = ruleType, f = field) => {
    if (type === 'simple' || !f) { setStyle((s) => ({ ...s, rule: null })); return; }
    setLoading(true);
    setErr('');
    try {
      const stats = await request('fieldStats', { layerId: layer.id, version: layer.currentVersion, field: f });
      const rule = type === 'categorized' ? categorizedRule(f, stats.values) : graduatedRule(f, stats.sortedNumbers);
      if (!rule) throw new Error('O campo não tem valores numéricos.');
      setStyle((s) => ({ ...s, rule }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const setClassColor = (i, color) => setStyle((s) => ({ ...s, rule: { ...s.rule, classes: s.rule.classes.map((c, k) => (k === i ? { ...c, color } : c)) } }));
  const setClassLabel = (i, label) => setStyle((s) => ({ ...s, rule: { ...s.rule, classes: s.rule.classes.map((c, k) => (k === i ? { ...c, label } : c)) } }));
  const legend = legendFor(style, fam);

  return (
    <div className="space-y-3">
      <fieldset disabled={!canEdit} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-slate-600">Cor base</span>
            <input type="color" value={style.color} onChange={(e) => set('color', e.target.value.toUpperCase())} className="mt-0.5 block h-8 w-14 rounded border border-slate-300 max-lg:h-11" />
          </label>
          {fam !== 'line' && fam !== 'polygon' && (
            <label className="block">
              <span className="text-slate-600">Símbolo</span>
              <select value={style.symbol} onChange={(e) => set('symbol', e.target.value)} className={input}>
                {Object.entries(SYMBOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          )}
          {fam !== 'line' && fam !== 'polygon' && (
            <label className="block">
              <span className="text-slate-600">Tamanho (px)</span>
              <input type="number" min="1" max="12" step="0.5" value={style.radius} onChange={(e) => set('radius', Number(e.target.value))} className={`${input} w-20`} />
            </label>
          )}
          {fam !== 'point' && (
            <label className="block">
              <span className="text-slate-600">Espessura (px)</span>
              <input type="number" min="0.5" max="10" step="0.5" value={style.weight} onChange={(e) => set('weight', Number(e.target.value))} className={`${input} w-20`} />
            </label>
          )}
          {fam === 'polygon' && (
            <label className="block">
              <span className="text-slate-600">Preenchimento</span>
              <input type="range" min="0" max="0.8" step="0.05" value={style.fillOpacity} onChange={(e) => set('fillOpacity', Number(e.target.value))} className="mt-2 block accent-accent-500" />
            </label>
          )}
        </div>

        <div>
          <p className="font-semibold">Estilo por atributo</p>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-slate-600">Tipo</span>
              <select value={ruleType} onChange={(e) => { setRuleType(e.target.value); generate(e.target.value, field); }} className={input}>
                <option value="simple">Único (sem atributo)</option>
                <option value="categorized">Categorias (valores distintos)</option>
                <option value="graduated">Classes numéricas (quantis)</option>
              </select>
            </label>
            {ruleType !== 'simple' && (
              <label className="block min-w-[180px] flex-1">
                <span className="text-slate-600">Campo</span>
                <select value={field} onChange={(e) => { setField(e.target.value); generate(ruleType, e.target.value); }} className={input}>
                  <option value="">Escolha…</option>
                  {attrs.filter((a) => ruleType !== 'graduated' || a.type === 'number').map((a) => <option key={a.name} value={a.name}>{a.name} ({a.type})</option>)}
                </select>
              </label>
            )}
            {ruleType !== 'simple' && field && (
              <button type="button" onClick={() => generate()} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 max-lg:min-h-11">
                {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                Recalcular classes
              </button>
            )}
          </div>
          {err && <p className="mt-1 text-red-700">{err}</p>}
          {style.rule && (
            <ul className="mt-2 space-y-1">
              {style.rule.classes.map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i} className="flex items-center gap-2">
                  <input type="color" value={c.color} onChange={(e) => setClassColor(i, e.target.value.toUpperCase())} aria-label={`Cor da classe ${c.label}`} className="h-6 w-9 rounded border border-slate-300 max-lg:h-10" />
                  <input value={c.label} onChange={(e) => setClassLabel(i, e.target.value)} aria-label="Rótulo da classe" className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-0.5 max-lg:min-h-11" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="block">
            <span className="text-slate-600">Zoom mínimo</span>
            <input type="number" min="0" max="20" value={zoom.min} onChange={(e) => setZoom((z) => ({ ...z, min: e.target.value }))} placeholder="—" className={`${input} w-20`} />
          </label>
          <label className="block">
            <span className="text-slate-600">Zoom máximo</span>
            <input type="number" min="0" max="22" value={zoom.max} onChange={(e) => setZoom((z) => ({ ...z, max: e.target.value }))} placeholder="—" className={`${input} w-20`} />
          </label>
        </div>
      </fieldset>

      <div className="rounded border border-slate-200 px-3 py-2">
        <p className="font-semibold">Legenda</p>
        {legend.title && <p className="text-slate-600">{legend.title}</p>}
        <ul className="mt-1 space-y-0.5">
          {legend.items.map((it, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="flex items-center gap-1.5"><LegendSwatch {...it} />{it.label ?? layer.name}</li>
          ))}
        </ul>
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={() => onSave({
            style,
            minZoom: zoom.min === '' ? null : Number(zoom.min),
            maxZoom: zoom.max === '' ? null : Number(zoom.max),
          })}
          className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-white hover:bg-accent-600 max-lg:min-h-11"
        >
          Salvar estilo
        </button>
      )}
    </div>
  );
}

function InfoTab({
  layer, groupPath, groupPaths, canEdit, onSave, onDelete,
}) {
  const [name, setName] = useState(layer.name);
  const [description, setDescription] = useState(layer.description ?? '');
  const [group, setGroup] = useState(groupPath ?? '');
  const m = layer.metadata ?? {};
  return (
    <div className="space-y-3">
      <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-x-3 gap-y-2 max-sm:grid-cols-1">
        <label className="col-span-2 block max-sm:col-span-1"><span className="text-slate-600">Nome</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} /></label>
        <label className="col-span-2 block max-sm:col-span-1"><span className="text-slate-600">Descrição</span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className={input} /></label>
        <label className="col-span-2 block max-sm:col-span-1">
          <span className="text-slate-600">Grupo</span>
          <input list="layer-info-groups" value={group} onChange={(e) => setGroup(e.target.value)} className={input} />
          <datalist id="layer-info-groups">{groupPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
      </fieldset>
      {canEdit && (
        <button type="button" disabled={name.trim().length < 2} onClick={() => onSave({ name: name.trim(), description: description.trim() || null }, { groupPath: group })} className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-white disabled:opacity-40 max-lg:min-h-11">Salvar</button>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded border border-slate-200 px-3 py-2 text-[12px] max-lg:text-[13.5px]">
        {layer.kind === 'external' ? (
          <>
            <dt className="text-slate-500">Origem</dt><dd>{layer.external?.type?.toUpperCase()} — <span className="break-all font-mono text-[11px]">{layer.external?.url}</span></dd>
            {layer.external?.layers && (<><dt className="text-slate-500">Camadas WMS</dt><dd>{layer.external.layers}</dd></>)}
          </>
        ) : (
          <>
            <dt className="text-slate-500">Arquivo de origem</dt><dd className="break-all">{m.fileName ?? '—'}</dd>
            <dt className="text-slate-500">Feições</dt><dd>{fmt(m.featureCount)}</dd>
            <dt className="text-slate-500">Geometria</dt><dd>{layer.geometryType}</dd>
            <dt className="text-slate-500">Referencial original</dt><dd>{m.originalCrs?.name ?? '—'} → EPSG:4326</dd>
            <dt className="text-slate-500">Atributos</dt><dd>{(layer.attributesSchema ?? []).map((a) => a.name).join(', ') || '—'}</dd>
          </>
        )}
        <dt className="text-slate-500">Fonte dos dados</dt><dd>{m.source ?? 'Envio da organização'}</dd>
        <dt className="text-slate-500">Atualizada em</dt><dd>{fmtDate(layer.updatedAt)}{layer.updatedBy ? ` por ${layer.updatedBy}` : ''}</dd>
        <dt className="text-slate-500">Criada por</dt><dd>{layer.createdBy ?? '—'} em {fmtDate(layer.createdAt)}</dd>
        <dt className="text-slate-500">Identificador</dt><dd className="break-all font-mono text-[11px]">{layer.id}</dd>
      </dl>
      {canEdit && (
        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 max-lg:min-h-11">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Excluir camada
        </button>
      )}
    </div>
  );
}

const MODE_LABEL = { create: 'Envio inicial', replace: 'Substituição', append: 'Anexação' };

function VersionsTab({
  layer, canEdit, onUpdateData, onRemoveVersion,
}) {
  const versions = [...(layer.versions ?? [])].sort((a, b) => b.version - a.version);
  return (
    <div className="space-y-2">
      {canEdit && (
        <button type="button" onClick={onUpdateData} className="inline-flex items-center gap-1.5 rounded bg-petrol-800 px-3 py-1.5 font-medium text-white hover:bg-petrol-700 max-lg:min-h-11">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Atualizar dados (substituir ou anexar)
        </button>
      )}
      <ul className="divide-y divide-slate-100 rounded border border-slate-200">
        {versions.map((v) => (
          <li key={v.version} className="flex items-start gap-2 px-3 py-2">
            <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${v.version === layer.currentVersion ? 'bg-accent-500 text-white' : 'bg-slate-100 text-slate-600'}`}>v{v.version}</span>
            <div className="min-w-0 flex-1">
              <p>{MODE_LABEL[v.mode] ?? v.mode} — {fmt(v.featureCount)} feições{v.fileName ? ` (${v.fileName})` : ''}</p>
              <p className="text-[11.5px] text-slate-500">
                {fmtDate(v.createdAt)} por {v.createdBy}
                {v.rejectedCount ? ` · ${fmt(v.rejectedCount)} rejeitada(s)` : ''}
                {v.removedAt ? ` · dados removidos em ${fmtDate(v.removedAt)}` : ''}
              </p>
            </div>
            {canEdit && v.version !== layer.currentVersion && !v.removedAt && (
              <button type="button" onClick={() => onRemoveVersion(v.version)} className="rounded px-1.5 py-1 text-[11.5px] text-red-700 hover:bg-red-50 max-lg:min-h-11">Liberar espaço</button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-slate-500">O histórico de versões é mantido. “Liberar espaço” apaga as feições de uma versão antiga, mas o registro dela continua aqui.</p>
    </div>
  );
}

function ShareTab({ layer, canEdit, onSave }) {
  const [visibility, setVisibility] = useState(layer.visibility ?? 'organization');
  const [shares, setShares] = useState(layer.shares ?? []);
  const [orgId, setOrgId] = useState('');
  return (
    <div className="space-y-2">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
        Sem backend, a camada só existe neste navegador. A visibilidade e o compartilhamento ficam registrados (e são respeitados pela interface), mas só passam a valer entre organizações quando houver um servidor.
      </p>
      <fieldset disabled={!canEdit} className="space-y-2">
        <label className="block max-w-[420px]">
          <span className="text-slate-600">Visibilidade</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={input}>
            {Object.entries(VISIBILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {visibility === 'shared' && (
          <div>
            <p className="text-slate-600">Organizações com acesso</p>
            <ul className="mt-1 space-y-1">
              {shares.map((s, i) => (
                <li key={s.orgId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{s.orgId}</span>
                  <select value={s.permission} onChange={(e) => setShares((list) => list.map((x, k) => (k === i ? { ...x, permission: e.target.value } : x)))} className="rounded border border-slate-300 px-1 py-0.5 max-lg:min-h-11">
                    <option value="view">ver</option>
                    <option value="edit">editar</option>
                  </select>
                  <button type="button" onClick={() => setShares((list) => list.filter((_, k) => k !== i))} className="text-red-700" aria-label={`Remover ${s.orgId}`}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex gap-2">
              <input value={orgId} onChange={(e) => setOrgId(e.target.value.trim())} placeholder="identificador da organização" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" />
              <button type="button" disabled={!orgId || shares.some((s) => s.orgId === orgId)} onClick={() => { setShares((l) => [...l, { orgId, permission: 'view' }]); setOrgId(''); }} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40 max-lg:min-h-11">Adicionar</button>
            </div>
          </div>
        )}
      </fieldset>
      {canEdit && (
        <button type="button" onClick={() => onSave({ visibility, shares: visibility === 'shared' ? shares : [] })} className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-white max-lg:min-h-11">Salvar</button>
      )}
    </div>
  );
}

