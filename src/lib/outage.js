/**
 * Informações do desligamento no modo com dados reais.
 *
 * Nada é preenchido por padrão: o operador informa os dados no formulário.
 * Campos ausentes aparecem como "Não informado" e bloqueiam a aprovação
 * do aviso quando são necessários ao texto (data e horários).
 */

export const EMPTY_OUTAGE_FORM = {
  orderId: '', feeder: '', reason: '', date: '', start: '', end: '', noticeDate: '', audience: '',
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
const NOT_INFORMED = 'Não informado';

/** "2026-10-20" → Date (meia-noite local) ou null. */
function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

const dateLabel = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const dateLong = (d) => `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
/** Formato da carta: "20 DEZEMBRO 2025". */
const dateLetter = (d) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
/** Formato da carta: "08:00h". */
export const timeLetter = (value) => (/^\d{2}:\d{2}$/.test(value ?? '') ? `${value}h` : null);

/** "13:00" → "13h"; "13:30" → "13h30". */
export function timeLabel(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  return m[2] === '00' ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`;
}

/**
 * Converte o formulário no formato consumido pelos componentes (mesmos
 * campos do OUTAGE demonstrativo), indicando o que falta.
 */
export function buildOutageView(form, { defaultAudience = null } = {}) {
  const date = parseIsoDate(form.date);
  const notice = parseIsoDate(form.noticeDate);
  const start = timeLabel(form.start);
  const end = timeLabel(form.end);
  const problems = [];
  if (form.start && form.end && form.start >= form.end) problems.push('O horário final deve ser posterior ao inicial.');
  let noticeDaysBefore = null;
  if (date && notice) {
    noticeDaysBefore = Math.round((date - notice) / 86400000);
    if (noticeDaysBefore < 0) problems.push('A data do aviso é posterior à data do desligamento.');
  }
  return {
    source: 'form',
    id: form.orderId || NOT_INFORMED,
    feeder: form.feeder || NOT_INFORMED,
    reason: form.reason || NOT_INFORMED,
    scheduledOn: NOT_INFORMED,
    dateLabel: date ? dateLabel(date) : NOT_INFORMED,
    dateLong: date ? dateLong(date) : null,
    start,
    end,
    noticeDate: notice ? dateLabel(notice) : null,
    letterDate: date ? dateLetter(date) : null,
    letterStart: timeLetter(form.start),
    letterEnd: timeLetter(form.end),
    audience: (form.audience?.trim() || defaultAudience || '').toUpperCase() || null,
    noticeDaysBefore,
    planningDaysBefore: null,
    hasDate: !!date,
    hasTimes: !!start && !!end,
    problems,
  };
}
