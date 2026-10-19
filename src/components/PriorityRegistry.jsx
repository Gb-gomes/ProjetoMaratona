import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Search, Pencil, Power, Trash2, MapPin, Plus, Save, TriangleAlert, Info, History, ArrowLeft, RotateCcw,
} from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { parseDecimal } from '../lib/csv.js';
import { CategoryChip } from './PriorityAlertsPanel.jsx';
import {
  PRIORITY_CATEGORIES, EMPTY_RECORD_FORM, validateRecordForm, recordToForm, nextRecordId, filterRecords, canDeleteRecord, todayIso,
} from '../lib/priorityRecords.js';

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
const ACTION_TEXT = {
  criado: 'Criado', editado: 'Editado', desativado: 'Desativado', reativado: 'Reativado', 'localização reavaliada': 'Localização reavaliada (comunidades alteradas)',
};

/**
 * Painel lateral único do cadastro de pontos prioritários: consulta
 * (pesquisa e filtros) e formulário de inclusão/edição, sem modais extras.
 */
export default function PriorityRegistry({
  open, view, editingId, prefill = null, mode, records, alerts, operator, operatorLocked = false, duplicateWarningMeters,
  onClose, onNavigate, onSave, onSetStatus, onDelete, onViewOnMap, onResetDemo, placeOf = null,
}) {
  const panelRef = useRef(null);
  const [by, setBy] = useState(operator ?? '');
  useEffect(() => { if (open) setBy((b) => b || operator || ''); }, [open, operator]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const isReal = mode === 'real';

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <button type="button" className="absolute inset-0 cursor-default bg-black/40" aria-label="Fechar cadastro" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="registry-title"
        className="relative flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl outline-none max-lg:h-[100dvh] max-lg:max-w-none"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 max-lg:gap-1 max-lg:pl-[max(0.5rem,env(safe-area-inset-left))] max-lg:pr-[max(0.25rem,env(safe-area-inset-right))] max-lg:pt-[max(0.25rem,env(safe-area-inset-top))] max-lg:pb-1">
          {view === 'form' && (
            <button type="button" onClick={() => onNavigate({ view: 'list' })} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:shrink-0 max-lg:place-items-center" aria-label="Voltar para a lista">
              <ArrowLeft className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            </button>
          )}
          <h2 id="registry-title" className="text-[14px] font-semibold text-petrol-900 max-lg:min-w-0 max-lg:text-[15px] max-lg:leading-tight">
            {view === 'form' ? (editingId ? `Editar ${editingId}` : 'Cadastrar ponto prioritário') : 'Cadastro de pontos prioritários'}
          </h2>
          <StatusBadge tone={isReal ? 'info' : 'neutral'} className="ml-1 max-sm:hidden">{isReal ? 'Teste real' : 'Demonstração'}</StatusBadge>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:inline-flex max-lg:min-h-11 max-lg:shrink-0 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px] max-lg:font-medium max-lg:text-petrol-700" aria-label="Fechar">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-2">
          <label className="flex items-center gap-2 text-[12px] text-slate-600 max-lg:flex-wrap max-lg:gap-1 max-lg:text-[13px]">
            Responsável pelas alterações *
            {operatorLocked ? (
              <input
                value={operator}
                readOnly
                title="Identificado pelo login do Cloudflare Access"
                className="min-w-0 flex-1 cursor-default rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-petrol-800 max-lg:min-h-11"
              />
            ) : (
              <input
                value={by}
                onChange={(e) => setBy(e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[13px] text-petrol-900 max-lg:min-h-11"
                placeholder="Nome ou matrícula"
                autoComplete="off"
              />
            )}
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {view === 'form' ? (
            <RecordForm
              key={editingId ?? `new${prefill?.nonce ?? ''}`}
              record={editingId ? records.find((r) => r.id === editingId) : null}
              prefill={editingId ? null : prefill}
              records={records}
              duplicateWarningMeters={duplicateWarningMeters}
              placeOf={placeOf}
              onCancel={() => onNavigate({ view: 'list' })}
              onSave={(value) => onSave(value, editingId, by)}
            />
          ) : (
            <RecordList
              records={records}
              alerts={alerts}
              onNew={() => onNavigate({ view: 'form', editingId: null })}
              onEdit={(id) => onNavigate({ view: 'form', editingId: id })}
              onSetStatus={(id, status) => onSetStatus(id, status, by)}
              onDelete={onDelete}
              onViewOnMap={onViewOnMap}
            />
          )}
        </div>

        <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-snug text-slate-600 max-lg:flex-wrap max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:text-[12px]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            Persistência provisória no localStorage deste navegador: não vale para outro computador, navegador ou perfil, não tem
            controle de acesso e pode ser apagada pela limpeza do navegador. Não registre dados médicos detalhados.
          </span>
          {!isReal && onResetDemo && (
            <button type="button" onClick={onResetDemo} className="inline-flex shrink-0 items-center gap-1 font-medium text-petrol-700 hover:underline max-lg:min-h-11">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Restaurar exemplos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RecordList({
  records, alerts, onNew, onEdit, onSetStatus, onDelete, onViewOnMap,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const list = useMemo(() => filterRecords(records, { query, category, status }), [records, query, category, status]);
  const select = 'rounded border border-slate-300 bg-white px-1.5 py-1 text-[12px] text-petrol-900 max-lg:min-h-11 max-lg:min-w-0 max-lg:flex-1';

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-[150px] flex-1 max-lg:basis-full">
          <span className="sr-only">Pesquisar pelo identificador</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar identificador"
            className="w-full rounded border border-slate-300 bg-white py-1 pl-7 pr-2 text-[12px] text-petrol-900 max-lg:min-h-11"
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={select} aria-label="Filtrar por categoria">
          <option value="all">Todas as categorias</option>
          <option value="A">A — Equipamento vital</option>
          <option value="B">B — Atividade produtiva</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Filtrar por status">
          <option value="all">Ativos e inativos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">{list.length} de {records.length} registro(s)</p>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1.5 rounded-md bg-petrol-700 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-petrol-800 max-lg:min-h-11 max-lg:text-[14px]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Cadastrar ponto prioritário
        </button>
      </div>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-[12px] text-slate-500">
          {records.length ? 'Nenhum registro com esses filtros.' : 'Nenhum ponto prioritário cadastrado.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((r) => {
            const active = r.status === 'active';
            const deletable = canDeleteRecord(r.id, alerts);
            return (
              <li key={r.id} className={`rounded-md border border-slate-200 px-2.5 py-2 ${active ? 'bg-white' : 'bg-slate-50'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <CategoryChip category={r.category} compact />
                  <span className="text-[13px] font-semibold text-petrol-900">{r.id}</span>
                  <StatusBadge tone={active ? 'success' : 'neutral'} className="!px-1.5 !text-[11px]">{active ? 'Ativo' : 'Inativo'}</StatusBadge>
                  {r.fictitious && <StatusBadge tone="neutral" className="!px-1.5 !text-[11px]">Fictício</StatusBadge>}
                </div>
                {r.label && <p className="mt-0.5 truncate text-[12px] text-slate-700">{r.label}</p>}
                {r.location?.rotulo && (
                  <p className="truncate text-[12px] text-petrol-700" title={`Gravado em ${fmtDate(r.location.at)}`}>
                    {r.location.rotulo}{r.location.confianca === 'baixa' ? ' ≈' : ''}
                  </p>
                )}
                <p className="text-[11px] text-slate-500">Atualizado em {fmtDate(r.updatedAt)} por {r.updatedBy}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-medium max-lg:gap-x-1 max-lg:gap-y-0 max-lg:text-[14px] max-lg:[&>button]:min-h-11 max-lg:[&>button]:px-1.5">
                  <button type="button" onClick={() => onViewOnMap(r.id)} disabled={!active} className="inline-flex items-center gap-1 text-petrol-700 hover:underline disabled:text-slate-400 disabled:no-underline" title={active ? undefined : 'Registros inativos não aparecem no mapa'}>
                    <MapPin className="h-3 w-3" aria-hidden="true" />Ver no mapa
                  </button>
                  <button type="button" onClick={() => onEdit(r.id)} className="inline-flex items-center gap-1 text-petrol-700 hover:underline">
                    <Pencil className="h-3 w-3" aria-hidden="true" />Editar
                  </button>
                  <button type="button" onClick={() => onSetStatus(r.id, active ? 'inactive' : 'active')} className="inline-flex items-center gap-1 text-petrol-700 hover:underline">
                    <Power className="h-3 w-3" aria-hidden="true" />{active ? 'Desativar' : 'Reativar'}
                  </button>
                  {deletable && (
                    <button type="button" onClick={() => onDelete(r.id)} className="inline-flex items-center gap-1 text-red-700 hover:underline">
                      <Trash2 className="h-3 w-3" aria-hidden="true" />Excluir
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-slate-500">
        Registros que já geraram alerta não podem ser excluídos: desative-os para preservar o histórico.
      </p>
    </div>
  );
}

function RecordForm({
  record, records, duplicateWarningMeters, onCancel, onSave, placeOf = null, prefill = null,
}) {
  // prefill: coordenada escolhida no mapa (busca por lat/long).
  const [form, setForm] = useState(() => (record ? recordToForm(record) : {
    ...EMPTY_RECORD_FORM,
    id: nextRecordId(records),
    registeredOn: todayIso(),
    ...(prefill ? { lat: prefill.lat.toFixed(6), lng: prefill.lng.toFixed(6) } : {}),
  }));
  const [check, setCheck] = useState(null); // resultado da última validação
  const [ackKey, setAckKey] = useState(null); // avisos já revistos para estes valores
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setAckKey(null); };
  const valuesKey = JSON.stringify(form);

  const submit = (e) => {
    e.preventDefault();
    const res = validateRecordForm(form, records, { editingId: record?.id ?? null, duplicateWarningMeters });
    setCheck(res);
    if (!res.ok) return;
    if (res.warnings.length && ackKey !== valuesKey) { setAckKey(valuesKey); return; }
    onSave(res.value);
  };

  const err = check?.errors ?? {};
  const warnings = check?.ok ? check.warnings : [];
  const confirming = warnings.length > 0 && ackKey === valuesKey;
  const input = (k) => `w-full rounded border bg-white px-2 py-1 text-[13px] text-petrol-900 max-lg:min-h-11 ${err[k] ? 'border-red-400' : 'border-slate-300'}`;
  const Label = ({ k, children, hint }) => (
    <span className="mb-0.5 block text-[12px] font-medium text-petrol-800">
      {children}
      {hint && <span className="ml-1 font-normal text-slate-500">{hint}</span>}
    </span>
  );
  const Err = ({ k }) => (err[k] ? <span className="mt-0.5 block text-[11px] text-red-700">{err[k]}</span> : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        <label className="block">
          <Label>Identificador interno *</Label>
          <input value={form.id} onChange={set('id')} disabled={!!record} className={input('id')} />
          <Err k="id" />
        </label>
        <label className="block">
          <Label>Data do cadastro *</Label>
          <input type="date" value={form.registeredOn} onChange={set('registeredOn')} max={todayIso()} className={input('registeredOn')} />
          <Err k="registeredOn" />
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Identificação operacional</Label>
        <input value={form.label} onChange={set('label')} className={input('label')} placeholder="Ex.: referência interna, sem dados pessoais desnecessários" />
      </label>
      <label className="block">
        <Label hint="(opcional; usado para confirmar a correspondência com a coluna de cliente do CSV)">Código da UC</Label>
        <input value={form.ucCode} onChange={set('ucCode')} className={input('ucCode')} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <Label hint="(graus decimais)">Latitude *</Label>
          <input value={form.lat} onChange={set('lat')} inputMode="decimal" className={input('lat')} placeholder="-21,3891" />
          <Err k="lat" />
        </label>
        <label className="block">
          <Label hint="(graus decimais)">Longitude *</Label>
          <input value={form.lng} onChange={set('lng')} inputMode="decimal" className={input('lng')} placeholder="-42,6964" />
          <Err k="lng" />
        </label>
      </div>
      <p className="-mt-1 text-[11px] text-slate-500">WGS84 / SIRGAS 2000. Coordenadas não são enviadas a nenhum serviço externo.</p>
      {placeOf && (() => {
        // Município, distrito e comunidade preenchidos pela coordenada (gravados ao salvar).
        const place = placeOf(parseDecimal(form.lat), parseDecimal(form.lng));
        if (!place) return null;
        return (
          <p className="-mt-1 rounded border border-petrol-100 bg-petrol-50 px-2 py-1 text-[12px] text-petrol-800 max-lg:text-[13px]" role="status">
            <b>Localização:</b> {place.rotulo}
            {place.comunidade?.aproximada && ' (localização aproximada)'}
            {place.origem_nome === 'comunidade_proxima' && ' (comunidade mais próxima, até 100 m)'}
          </p>
        );
      })()}

      <fieldset>
        <legend className="mb-1 text-[12px] font-medium text-petrol-800">Categoria de prioridade *</legend>
        <div className="grid gap-1.5">
          {Object.values(PRIORITY_CATEGORIES).map((c) => (
            <label
              key={c.code}
              className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-1.5 ${
                form.category === c.code ? (c.code === 'A' ? 'border-red-400 bg-red-50' : 'border-violet-400 bg-violet-50') : 'border-slate-200'
              }`}
            >
              <input type="radio" name="category" value={c.code} checked={form.category === c.code} onChange={set('category')} className="mt-0.5 accent-accent-500 max-lg:h-5 max-lg:w-5" />
              <span>
                <CategoryChip category={c.code} />
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{c.description}</span>
              </span>
            </label>
          ))}
        </div>
        <Err k="category" />
      </fieldset>

      <label className="block">
        <Label hint={form.category === 'A' ? '(mínimo necessário; sem dados médicos)' : undefined}>Descrição da situação *</Label>
        <textarea value={form.situation} onChange={set('situation')} rows={2} className={input('situation')} placeholder={form.category === 'A' ? 'Ex.: equipamento vital informado e validado' : ''} />
        <Err k="situation" />
      </label>
      {form.category === 'A' && (
        <label className="block">
          <Label hint="(opcional; ex.: nº do protocolo interno)">Referência da validação autorizada</Label>
          <input value={form.validationRef} onChange={set('validationRef')} className={input('validationRef')} />
        </label>
      )}
      {form.category === 'B' && (
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <label className="block">
            <Label>Atividade *</Label>
            <input value={form.activity} onChange={set('activity')} className={input('activity')} placeholder="Ex.: resfriamento de leite" />
            <Err k="activity" />
          </label>
          <label className="block">
            <Label>Impacto esperado *</Label>
            <input value={form.impact} onChange={set('impact')} className={input('impact')} placeholder="Ex.: perda do leite armazenado" />
            <Err k="impact" />
          </label>
        </div>
      )}
      <label className="block">
        <Label hint="(opcional)">Observações operacionais</Label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} className={input('notes')} />
      </label>
      <fieldset className="flex items-center gap-3 text-[12px] text-petrol-900">
        <legend className="sr-only">Status do registro</legend>
        <span className="text-[12px] font-medium text-petrol-800">Status *</span>
        {[['active', 'Ativo'], ['inactive', 'Inativo']].map(([v, l]) => (
          <label key={v} className="inline-flex items-center gap-1 max-lg:min-h-11 max-lg:gap-2 max-lg:text-[14px]">
            <input type="radio" name="status" value={v} checked={form.status === v} onChange={set('status')} className="accent-accent-500 max-lg:h-5 max-lg:w-5" />
            {l}
          </label>
        ))}
      </fieldset>

      {check && !check.ok && (
        <p className="flex gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Corrija os campos destacados antes de salvar.
        </p>
      )}
      {confirming && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900" role="alert">
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />Revise antes de salvar</p>
          <ul className="mt-0.5 list-disc pl-5">{warnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white max-lg:min-h-11 max-lg:flex-1 max-lg:justify-center max-lg:text-[15px] ${confirming ? 'bg-amber-600 hover:bg-amber-700' : 'bg-petrol-700 hover:bg-petrol-800'}`}>
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {confirming ? 'Salvar mesmo assim' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:flex-1 max-lg:text-[15px]">
          Cancelar
        </button>
      </div>

      {record?.history?.length > 0 && (
        <div className="border-t border-slate-100 pt-2 text-[12px] text-slate-600">
          <p className="flex items-center gap-1 font-semibold text-petrol-900"><History className="h-3 w-3" aria-hidden="true" />Histórico do registro</p>
          <ol className="mt-0.5 space-y-0.5">
            {[...record.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                {fmtDate(h.at)} · <b>{ACTION_TEXT[h.action] ?? h.action}</b> · {h.by}
                {h.fields?.length ? ` · ${h.fields.join(', ')}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </form>
  );
}
