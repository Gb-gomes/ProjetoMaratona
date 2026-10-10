import { RADIO_LETTER } from '../config.js';

/**
 * Construção dos textos de comunicação.
 * buildRegionalNotice / buildTraditionalNotice: modo demonstração.
 * buildUnitNotice / buildTraditionalFromNames: modo com dados reais.
 * Nenhum texto é enviado: a aprovação é local.
 */

/** "A", "A e B", "A, B e C". */
export function joinNatural(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const outageSentence = (outage) =>
  `A Energisa informa que haverá um desligamento programado de energia elétrica no dia ${outage.dateLong}, das ${outage.start} às ${outage.end}.`;

/**
 * Aviso agrupado por região, seguindo a ordem da lista recebida.
 * Retorna string vazia quando não há região selecionada.
 */
export function buildRegionalNotice(regionNames, outage) {
  if (!regionNames.length) return '';
  const target = regionNames.length === 1
    ? `moradores da região ${regionNames[0]}`
    : `moradores das regiões ${joinNatural(regionNames)}`;
  return `Atenção, ${target}. ${outageSentence(outage)}`;
}

const PLURAL = { Fazenda: 'das Fazendas', Sítio: 'dos Sítios', Chácara: 'das Chácaras', Estância: 'das Estâncias' };
const SINGULAR = { Fazenda: 'da Fazenda', Sítio: 'do Sítio', Chácara: 'da Chácara', Estância: 'da Estância' };

/**
 * Aviso tradicional: lista cada propriedade individualmente, agrupando
 * apenas por tipo (Fazendas, Sítios...), na ordem em que aparecem.
 */
export function buildTraditionalNotice(points, outage) {
  if (!points.length) return '';
  const byType = new Map();
  points.forEach((p) => {
    if (!byType.has(p.propertyType)) byType.set(p.propertyType, []);
    byType.get(p.propertyType).push(p.propertyName);
  });
  const parts = [...byType.entries()].map(([type, names]) =>
    `${names.length > 1 ? PLURAL[type] : SINGULAR[type]} ${joinNatural(names)}`);
  return `Atenção aos clientes ${joinNatural(parts)}. ${outageSentence(outage)}`;
}

export const countCharacters = (text) => [...(text ?? '')].length;
export const countWords = (text) => (text?.trim() ? text.trim().split(/\s+/).length : 0);

/* ------------------------------------------------------------------ */
/* Modo com dados reais                                                */
/* ------------------------------------------------------------------ */

/** Marcações entre colchetes indicam informação pendente no texto. */
export const PLACEHOLDER_RE = /\[[^\]]+\]/;
export const hasPlaceholders = (text) => PLACEHOLDER_RE.test(text ?? '');

/**
 * Nome de uma unidade adequado à locução, ou null quando não há nome
 * validado. Ordem: tabela de correspondência validada → nome oficial da
 * camada (somente se a configuração declarar que ele pode ser usado na
 * comunicação). Nunca cria nomes.
 *
 * @returns {{name:string|null, origin:'correspondence'|'official'|null}}
 */
export function resolveSpeakableName(unit, { correspondence = {}, officialNameApproved = false } = {}) {
  const entry = correspondence[unit.code] ?? correspondence[unit.id];
  if (entry?.name) return { name: entry.name, origin: entry.origin ?? 'correspondence', entry };
  if (officialNameApproved && unit.name) return { name: unit.name, origin: 'official' };
  return { name: null, origin: null };
}

function realOutageSentence(outage) {
  const date = outage?.dateLong ?? '[data não informada]';
  const start = outage?.start ?? '[horário inicial não informado]';
  const end = outage?.end ?? '[horário final não informado]';
  return `A Energisa informa que haverá um desligamento programado de energia elétrica em ${date}, das ${start} às ${end}.`;
}

/**
 * Aviso por unidade territorial (modo real).
 * Unidades sem nome validado entram como marcação pendente com o código
 * oficial, o que impede a aprovação até o operador resolver.
 *
 * @returns {{text:string, pendingCodes:string[], missingOutage:string[]}}
 */
export function buildUnitNotice(units, outage, { unitType = 'unidade', ...nameOptions } = {}) {
  const missingOutage = [
    !outage?.dateLong && 'data',
    !outage?.start && 'horário inicial',
    !outage?.end && 'horário final',
  ].filter(Boolean);
  if (!units?.length) return { text: '', pendingCodes: [], missingOutage };

  const pendingCodes = [];
  const names = units.map((u) => {
    const { name } = resolveSpeakableName(u, nameOptions);
    if (name) return name;
    pendingCodes.push(u.code);
    return `[denominação pendente de validação — ${unitType.toLowerCase()} ${u.code}]`;
  });
  return {
    text: `Atenção, moradores de ${joinNatural(names)}. ${realOutageSentence(outage)}`,
    pendingCodes,
    missingOutage,
  };
}

/** Aviso tradicional a partir dos nomes de propriedade do CSV (modo real). */
export function buildTraditionalFromNames(names, outage) {
  const unique = [...new Set((names ?? []).filter(Boolean))];
  if (!unique.length) return '';
  return `Atenção aos clientes ${joinNatural(unique)}. ${realOutageSentence(outage)}`;
}

/* ------------------------------------------------------------------ */
/* Carta padrão para as rádios (modelo Energisa)                       */
/* ------------------------------------------------------------------ */

/** Marcação de região ainda sem nome: usa o número da lista e o contexto, nunca o código. */
export function pendingRegionLabel(unit) {
  const context = (unit.context ?? []).map((c) => c.value).join(' | ');
  const number = String(unit.order ?? '').padStart(2, '0');
  return `[NOMEAR REGIÃO ${number}${context ? ` — ${context}` : ''}]`;
}

/**
 * Monta a carta padrão para as rádios.
 *
 * - ENDEREÇOS lista somente nomes (correspondência validada, nome definido
 *   pelo operador ou nome oficial aprovado). Nomes repetidos aparecem uma vez.
 * - Região sem nome entra como "[NOMEAR REGIÃO nn — contexto]" e bloqueia a
 *   aprovação até ser nomeada ou retirada da seleção.
 * - Data/horários ausentes entram como marcação entre colchetes.
 *
 * @param {object[]} units unidades selecionadas, na ordem da lista
 * @param {object} outage dados do desligamento (letterDate, letterStart, letterEnd, audience)
 * @param {{nameOf?: (u:object) => string|null}} options
 * @returns {{text:string, pendingUnits:object[], missingOutage:string[], names:string[]}}
 */
export function buildRadioLetter(units, outage, { nameOf = (u) => u.name ?? null } = {}) {
  const missingOutage = [
    !outage?.letterDate && 'data',
    !outage?.letterStart && 'horário inicial',
    !outage?.letterEnd && 'horário final',
    !outage?.audience && 'público (Pessoal de …)',
  ].filter(Boolean);
  if (!units?.length) return { text: '', pendingUnits: [], missingOutage, names: [] };

  const pendingUnits = [];
  const seen = new Set();
  const lines = [];
  units.forEach((u) => {
    const name = nameOf(u);
    if (!name) {
      pendingUnits.push(u);
      lines.push(pendingRegionLabel(u));
      return;
    }
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(name);
  });

  const body = RADIO_LETTER.body
    .replace('{PUBLICO}', outage?.audience ?? '[PÚBLICO NÃO INFORMADO]')
    .replace('{DATA}', outage?.letterDate ?? '[DATA NÃO INFORMADA]')
    .replace('{INICIO}', outage?.letterStart ?? '[HORÁRIO INICIAL]')
    .replace('{FIM}', outage?.letterEnd ?? '[HORÁRIO FINAL]');

  const text = [
    RADIO_LETTER.title,
    '',
    body,
    '',
    RADIO_LETTER.addressesLabel,
    ...lines,
    '',
    ...RADIO_LETTER.closing.flatMap((c, i) => (i ? ['', c] : [c])),
  ].join('\n');

  return { text, pendingUnits, missingOutage, names: lines.filter((l) => !PLACEHOLDER_RE.test(l)) };
}
