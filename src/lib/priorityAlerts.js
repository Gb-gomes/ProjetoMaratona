/**
 * Fluxo de revisão dos alertas de pontos prioritários.
 *
 * Cada alerta é identificado pelo desligamento analisado (referência
 * congelada no momento do processamento) e pelo registro prioritário.
 * O histórico nunca é apagado. Abrir detalhes ou copiar a carta não muda o
 * status: só ações explícitas (analisar, encaminhar, concluir, reabrir).
 *
 * O histórico guarda referências (id do registro, rótulo do ponto do CSV,
 * distância), nunca coordenadas do CSV nem dados pessoais.
 *
 * Este controle é um apoio à decisão: não substitui os procedimentos
 * oficiais da empresa e não bloqueia nenhuma operação real.
 */
import { MATCH_LABEL } from './priorityMatch.js';

export const ALERT_STATUS = {
  novo: { label: 'Pendente', tone: 'danger' },
  em_analise: { label: 'Em análise', tone: 'warning' },
  encaminhado: { label: 'Encaminhado', tone: 'info' },
  concluido: { label: 'Análise concluída', tone: 'success' },
};

export const DECISIONS = [
  'Ciente — sem providência adicional',
  'Contato prévio com o cliente realizado',
  'Providência operacional encaminhada à área responsável',
  'Não é o cliente prioritário (correspondência descartada)',
  'Outra decisão (descrever nas observações)',
];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();

/** Referência do desligamento analisado (congelada no processamento). */
export function buildAnalysisRef({ outageId, dateLabel, fileName, processedAt }) {
  const id = outageId && outageId !== 'Não informado' ? outageId : null;
  const date = dateLabel && dateLabel !== 'Não informado' ? dateLabel : null;
  return {
    key: [fileName || 'sem-arquivo', id || 'sem-ordem', date || 'sem-data'].join('|'),
    outageId: id,
    dateLabel: date,
    fileName: fileName || null,
    processedAt: processedAt ?? nowIso(),
  };
}

export const alertKey = (refKey, recordId) => `${refKey}::${recordId}`;

/**
 * Garante uma entrada de histórico para cada alerta da análise atual.
 * Devolve o MESMO objeto quando nada mudou.
 */
export function syncAlerts(store, analysis, ref, { at = nowIso() } = {}) {
  if (!analysis || analysis.blocked || !ref) return store;
  let next = store;
  analysis.alerts.forEach((a) => {
    const key = alertKey(ref.key, a.recordId);
    const existing = next[key];
    const snapshot = {
      matchStatus: a.matchStatus, distanceMeters: a.distanceMeters, csvPoint: a.primaryPointLabel, evidence: a.evidence,
    };
    if (!existing) {
      next = {
        ...next,
        [key]: {
          key, recordId: a.recordId, category: a.category, ref, status: 'novo', ...snapshot, createdAt: at, updatedAt: at,
          history: [{ action: 'gerado', by: 'sistema', at, note: `${MATCH_LABEL[a.matchStatus]} — ponto ${a.primaryPointLabel}, ${a.distanceMeters} m.` }],
        },
      };
    } else if (existing.matchStatus !== a.matchStatus || existing.csvPoint !== a.primaryPointLabel) {
      // A base da análise mudou: uma conclusão anterior deixa de valer e o alerta volta a pendente.
      const reopen = existing.status === 'concluido';
      next = {
        ...next,
        [key]: {
          ...existing, ...snapshot, updatedAt: at,
          ...(reopen ? { status: 'novo', decision: null, decidedBy: null, decidedAt: null } : {}),
          history: [...existing.history, {
            action: 'reavaliado', by: 'sistema', at,
            note: `${MATCH_LABEL[a.matchStatus]} — ponto ${a.primaryPointLabel}, ${a.distanceMeters} m.${reopen ? ' A correspondência mudou: a conclusão anterior foi reaberta.' : ''}`,
            ...(reopen ? { from: 'concluido', to: 'novo' } : {}),
          }],
        },
      };
    }
  });
  return next;
}

const ACTIONS = {
  analisar: { from: ['novo', 'encaminhado'], to: 'em_analise', label: 'Marcado em análise' },
  encaminhar: { from: ['novo', 'em_analise'], to: 'encaminhado', label: 'Encaminhado' },
  concluir: { from: ['novo', 'em_analise', 'encaminhado'], to: 'concluido', label: 'Análise concluída' },
  reabrir: { from: ['concluido'], to: 'em_analise', label: 'Reaberto' },
  anotar: { from: ['novo', 'em_analise', 'encaminhado', 'concluido'], to: null, label: 'Observação' },
};

/** Aplica uma ação explícita do operador. Lança erro se faltar informação. */
export function transitionAlert(store, key, {
  action, by, note = '', decision = '', forwardedTo = '', at = nowIso(),
}) {
  const alert = store[key];
  if (!alert) throw new Error('Alerta não encontrado.');
  const rule = ACTIONS[action];
  if (!rule) throw new Error('Ação desconhecida.');
  if (!rule.from.includes(alert.status)) throw new Error(`Ação indisponível para um alerta "${ALERT_STATUS[alert.status].label}".`);
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável.');
  if (action === 'encaminhar' && !clean(forwardedTo)) throw new Error('Informe para quem/qual área o caso foi encaminhado.');
  if (action === 'concluir' && !clean(decision)) throw new Error('Registre a decisão operacional para concluir.');
  if (action === 'concluir' && decision === DECISIONS[DECISIONS.length - 1] && !clean(note)) {
    throw new Error('Descreva a decisão nas observações.');
  }
  if ((action === 'reabrir' || action === 'anotar') && !clean(note)) throw new Error('Escreva a observação.');

  const entry = {
    action, by: who, at, note: clean(note),
    ...(decision ? { decision: clean(decision) } : {}),
    ...(forwardedTo ? { forwardedTo: clean(forwardedTo) } : {}),
    ...(rule.to ? { from: alert.status, to: rule.to } : {}),
  };
  return {
    ...store,
    [key]: {
      ...alert,
      status: rule.to ?? alert.status,
      ...(action === 'concluir' ? { decision: clean(decision), decidedBy: who, decidedAt: at } : {}),
      ...(action === 'reabrir' ? { decision: null, decidedBy: null, decidedAt: null } : {}),
      ...(action === 'encaminhar' ? { forwardedTo: clean(forwardedTo) } : {}),
      updatedAt: at,
      history: [...alert.history, entry],
    },
  };
}

export const ACTION_LABEL = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]));
ACTION_LABEL.gerado = 'Alerta gerado';
ACTION_LABEL.reavaliado = 'Reavaliado';

/**
 * Situação de revisão da análise atual.
 * Enquanto houver alerta de equipamento vital (categoria A) sem análise
 * concluída, o desligamento não pode ser apresentado como validado.
 */
export function alertGate(analysis, store, ref) {
  if (!analysis || analysis.blocked || !ref) {
    return {
      pendingVital: [], pendingOther: [], blocked: false, message: null,
    };
  }
  const statusOf = (a) => store[alertKey(ref.key, a.recordId)]?.status ?? 'novo';
  const pending = analysis.alerts.filter((a) => statusOf(a) !== 'concluido');
  const pendingVital = pending.filter((a) => a.category === 'A');
  const pendingOther = pending.filter((a) => a.category !== 'A');
  return {
    pendingVital,
    pendingOther,
    blocked: pendingVital.length > 0,
    message: pendingVital.length
      ? `Revisão pendente: ${pendingVital.length} alerta(s) de equipamento vital sem análise concluída (${pendingVital.map((a) => a.recordId).join(', ')}). O desligamento não pode ser apresentado como validado.`
      : null,
  };
}

/** Ação recomendada para a revisão (texto de apoio, não uma ordem operacional). */
export function recommendedAction(alert) {
  const vital = alert.category === 'A';
  if (alert.matchStatus === 'review') {
    return 'Revisar a divergência indicada (identificador, coordenadas ou ambiguidade) antes de qualquer conclusão. Consulte os registros oficiais da empresa.';
  }
  if (alert.matchStatus === 'possible') {
    return vital
      ? 'Conferir, pelos procedimentos oficiais, se a unidade consumidora cadastrada é a mesma do ponto do CSV. Até a conferência, trate como possível cliente com equipamento vital afetado.'
      : 'Conferir se a unidade cadastrada é a mesma do ponto do CSV e avaliar o impacto na atividade produtiva.';
  }
  return vital
    ? 'Avaliar com a equipe responsável, conforme procedimento oficial, as providências para o cliente com equipamento vital antes do desligamento.'
    : 'Avaliar com a equipe responsável as providências para reduzir o impacto na atividade produtiva.';
}
