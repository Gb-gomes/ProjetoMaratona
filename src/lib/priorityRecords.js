/**
 * Cadastro manual de pontos prioritários (estrutura e validação).
 *
 * Solução intermediária enquanto não há integração com o cadastro
 * corporativo de clientes. Guarda apenas o mínimo necessário para a
 * identificação operacional: nenhum dado médico detalhado.
 *
 * Coordenadas em graus decimais, WGS84 / SIRGAS 2000 (diferença entre os
 * dois é submétrica, desprezível para as tolerâncias usadas).
 */
import { parseDecimal } from './csv.js';

export const PRIORITY_CATEGORIES = {
  A: {
    code: 'A',
    label: 'Equipamento vital',
    short: 'Categoria A — Equipamento vital',
    description: 'Pessoa que depende de equipamento elétrico para a preservação da vida, conforme informação validada pelos procedimentos autorizados da empresa.',
  },
  B: {
    code: 'B',
    label: 'Atividade produtiva crítica',
    short: 'Categoria B — Atividade produtiva crítica',
    description: 'Interrupção pode causar perdas relevantes de produção, danos a produtos ou animais ou interrupção de processos essenciais.',
  },
};

export const RECORD_STATUS = { active: 'active', inactive: 'inactive' };

export const EMPTY_RECORD_FORM = {
  id: '', label: '', ucCode: '', lat: '', lng: '', category: '', situation: '', activity: '', impact: '',
  validationRef: '', notes: '', registeredOn: '', status: RECORD_STATUS.active,
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Termos que sugerem dado médico detalhado (apenas aviso, nunca bloqueio). */
const MEDICAL_HINT = /\b(cid|diagn[oó]stic\w*|doen[cç]a\w*|laudo\w*|medica[cç][aã]o|medicamento\w*|patologia\w*|enfermidade\w*)\b/i;

/** Distância geodésica aproximada (Haversine), em metros. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const isValidCoordinate = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** Próximo identificador sugerido (PP-0001, PP-0002…). */
export function nextRecordId(records, prefix = 'PP') {
  const max = records.reduce((m, r) => {
    const n = new RegExp(`^${prefix}-(\\d+)$`).exec(r.id)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Registro → valores do formulário. */
export function recordToForm(r) {
  return {
    ...EMPTY_RECORD_FORM,
    ...Object.fromEntries(Object.keys(EMPTY_RECORD_FORM).map((k) => [k, r[k] ?? ''])),
    lat: r.lat != null ? String(r.lat) : '',
    lng: r.lng != null ? String(r.lng) : '',
    status: r.status ?? RECORD_STATUS.active,
  };
}

/**
 * Valida o formulário.
 * @param {object} form valores digitados
 * @param {object[]} records cadastros existentes
 * @param {{ editingId?: string|null, duplicateWarningMeters?: number, today?: string }} options
 * @returns {{ ok:boolean, errors:Record<string,string>, warnings:Array<{code:string,message:string,ids?:string[]}>, value:object|null }}
 */
export function validateRecordForm(form, records, { editingId = null, duplicateWarningMeters = 15, today = todayIso() } = {}) {
  const errors = {};
  const warnings = [];
  const id = clean(form.id);
  const lat = parseDecimal(form.lat);
  const lng = parseDecimal(form.lng);
  const category = form.category;

  if (!id) errors.id = 'Informe o identificador interno.';
  else if (!/^[\w.-]{2,30}$/.test(id)) errors.id = 'Use de 2 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.';
  else if (records.some((r) => r.id === id && r.id !== editingId)) errors.id = 'Já existe um registro com este identificador.';

  if (clean(form.lat) === '') errors.lat = 'Informe a latitude.';
  else if (!Number.isFinite(lat)) errors.lat = 'Latitude inválida. Use graus decimais (ex.: -21,3891).';
  else if (lat < -90 || lat > 90) errors.lat = 'A latitude deve estar entre -90 e 90.';

  if (clean(form.lng) === '') errors.lng = 'Informe a longitude.';
  else if (!Number.isFinite(lng)) errors.lng = 'Longitude inválida. Use graus decimais (ex.: -42,6964).';
  else if (lng < -180 || lng > 180) errors.lng = 'A longitude deve estar entre -180 e 180.';

  const coordsOk = !errors.lat && !errors.lng;
  if (coordsOk && lat === 0 && lng === 0) errors.lat = 'Coordenada (0, 0) não é uma localização válida.';

  if (!PRIORITY_CATEGORIES[category]) errors.category = 'Selecione a categoria de prioridade.';
  if (clean(form.situation).length < 3) errors.situation = 'Descreva a situação (mínimo de 3 caracteres).';
  if (clean(form.situation).length > 280) errors.situation = 'Use no máximo 280 caracteres.';
  if (category === 'B') {
    if (clean(form.activity).length < 3) errors.activity = 'Descreva a atividade produtiva.';
    if (clean(form.impact).length < 3) errors.impact = 'Descreva o impacto esperado da interrupção.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.registeredOn ?? '')) errors.registeredOn = 'Informe a data do cadastro.';
  else if (form.registeredOn > today) errors.registeredOn = 'A data do cadastro não pode estar no futuro.';
  if (![RECORD_STATUS.active, RECORD_STATUS.inactive].includes(form.status)) errors.status = 'Status inválido.';

  // Consistência (avisos: o operador decide).
  if (coordsOk && !errors.lat) {
    const inBrazil = lat >= -34 && lat <= 5.5 && lng >= -74.1 && lng <= -28.6;
    const swapped = lng >= -34 && lng <= 5.5 && lat >= -74.1 && lat <= -28.6;
    if (!inBrazil) {
      warnings.push({
        code: swapped ? 'swapped' : 'outside-brazil',
        message: swapped
          ? 'Latitude e longitude parecem invertidas. Confira antes de salvar.'
          : 'A coordenada está fora do território brasileiro. Confira antes de salvar.',
      });
    }
    if (form.status === RECORD_STATUS.active) {
      const near = records.filter((r) => r.id !== editingId && r.status === RECORD_STATUS.active
        && isValidCoordinate(r.lat, r.lng) && haversineMeters(lat, lng, r.lat, r.lng) <= duplicateWarningMeters);
      if (near.length) {
        warnings.push({
          code: 'duplicate-location',
          ids: near.map((r) => r.id),
          message: `Já existe registro ativo a até ${duplicateWarningMeters} m: ${near.map((r) => r.id).join(', ')}. Pode ser outra unidade consumidora no mesmo local; revise antes de salvar.`,
        });
      }
    }
  }
  const uc = clean(form.ucCode);
  if (uc) {
    const sameUc = records.filter((r) => r.id !== editingId && r.status === RECORD_STATUS.active && clean(r.ucCode) === uc);
    if (sameUc.length) {
      warnings.push({
        code: 'duplicate-uc', ids: sameUc.map((r) => r.id),
        message: `O código da UC "${uc}" já está em: ${sameUc.map((r) => r.id).join(', ')}.`,
      });
    }
  }
  const freeText = [form.situation, form.notes, form.activity, form.impact].join(' ');
  if (MEDICAL_HINT.test(freeText)) {
    warnings.push({
      code: 'medical-detail',
      message: 'O texto parece conter informação médica. Registre só o necessário para a identificação operacional (ex.: "equipamento vital validado").',
    });
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    warnings,
    value: ok ? {
      id,
      label: clean(form.label),
      ucCode: uc,
      lat,
      lng,
      category,
      situation: clean(form.situation),
      activity: category === 'B' ? clean(form.activity) : '',
      impact: category === 'B' ? clean(form.impact) : '',
      validationRef: category === 'A' ? clean(form.validationRef) : '',
      notes: clean(form.notes),
      registeredOn: form.registeredOn,
      status: form.status,
    } : null,
  };
}

const TRACKED = ['label', 'ucCode', 'lat', 'lng', 'category', 'situation', 'activity', 'impact', 'validationRef', 'notes', 'registeredOn', 'status'];
const FIELD_LABEL = {
  label: 'identificação', ucCode: 'código da UC', lat: 'latitude', lng: 'longitude', category: 'categoria', situation: 'situação',
  activity: 'atividade', impact: 'impacto', validationRef: 'referência da validação', notes: 'observações', registeredOn: 'data do cadastro', status: 'status',
};

/** Cria ou altera um registro, mantendo o histórico. Retorna a nova lista. */
export function upsertRecord(records, value, { by, editingId = null, at = nowIso() }) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pelo cadastro.');
  if (!editingId) {
    if (records.some((r) => r.id === value.id)) throw new Error('Identificador já cadastrado.');
    const record = {
      ...value, createdAt: at, createdBy: who, updatedAt: at, updatedBy: who,
      history: [{ action: 'criado', by: who, at }],
    };
    return [...records, record];
  }
  const current = records.find((r) => r.id === editingId);
  if (!current) throw new Error('Registro não encontrado.');
  if (value.id !== editingId) throw new Error('O identificador interno não pode ser alterado.');
  const changed = TRACKED.filter((k) => String(current[k] ?? '') !== String(value[k] ?? ''));
  if (!changed.length) return records;
  const statusOnly = changed.length === 1 && changed[0] === 'status';
  const action = statusOnly ? (value.status === RECORD_STATUS.active ? 'reativado' : 'desativado') : 'editado';
  const entry = { action, by: who, at, fields: changed.map((k) => FIELD_LABEL[k]) };
  return records.map((r) => (r.id === editingId
    ? { ...r, ...value, updatedAt: at, updatedBy: who, history: [...(r.history ?? []), entry] }
    : r));
}

/** Ativa ou desativa um registro (o registro e o histórico são preservados). */
export function setRecordStatus(records, id, status, { by, note = '', at = nowIso() }) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável.');
  return records.map((r) => {
    if (r.id !== id || r.status === status) return r;
    return {
      ...r, status, updatedAt: at, updatedBy: who,
      history: [...(r.history ?? []), {
        action: status === RECORD_STATUS.active ? 'reativado' : 'desativado', by: who, at, note: clean(note),
      }],
    };
  });
}

/** Um registro só pode ser excluído se nunca participou de um alerta. */
export function canDeleteRecord(id, alertStore) {
  return !Object.values(alertStore ?? {}).some((a) => a.recordId === id);
}

export function deleteRecord(records, id, alertStore) {
  if (!canDeleteRecord(id, alertStore)) {
    throw new Error('Este registro já tem alerta ou histórico operacional. Desative-o em vez de excluir.');
  }
  return records.filter((r) => r.id !== id);
}

/** Pesquisa e filtros da lista de cadastro. */
export function filterRecords(records, { query = '', category = 'all', status = 'all' } = {}) {
  const q = clean(query).toLowerCase();
  return records
    .filter((r) => (category === 'all' || r.category === category)
      && (status === 'all' || r.status === status)
      && (!q || r.id.toLowerCase().includes(q) || (r.label ?? '').toLowerCase().includes(q) || (r.ucCode ?? '').toLowerCase().includes(q)))
    .sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === RECORD_STATUS.active ? -1 : 1));
}

export { todayIso };
