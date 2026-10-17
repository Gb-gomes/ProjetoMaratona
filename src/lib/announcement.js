/**
 * Decide COMO cada região selecionada é citada na carta para as rádios.
 *
 * Regra (ANNOUNCEMENT_RULES em config.js):
 *  - Região com menos de N clientes afetados → cita o NOME DAS PROPRIEDADES
 *    desses clientes (coluna "propriedade" do CSV), e não a região. Assim a
 *    região inteira não fica esperando um desligamento que não é dela.
 *  - Caso contrário → cita o nome da região.
 *
 * Clientes = valores distintos da coluna de cliente, quando mapeada (pontos
 * sem cliente contam um a um); sem essa coluna, conta-se pontos.
 *
 * O operador pode forçar a forma de citação por região ('region' ou
 * 'properties'). Nada é inventado: se faltar o nome de alguma propriedade,
 * a região também é citada e uma observação explica o motivo.
 */
import { pendingRegionLabel } from './communicationUtils.js';

export const ANNOUNCE_MODE = { auto: 'auto', region: 'region', properties: 'properties' };

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (u) => String(u.order ?? '').padStart(2, '0');

/** Quantidade de clientes afetados de uma unidade. */
export function countClients(unitPoints, clientMapped) {
  if (!clientMapped) return unitPoints.length;
  const ids = new Set();
  let withoutId = 0;
  unitPoints.forEach((p) => {
    const c = clean(p.client);
    if (c) ids.add(c); else withoutId += 1;
  });
  return ids.size + withoutId;
}

/**
 * @param {object[]} units unidades selecionadas, na ordem da lista
 * @param {object[]} points pontos do resultado (com unitId, client, property)
 * @param {{
 *   nameOf: (u:object) => string|null,
 *   namesOf?: (u:object) => string[]|null,   // vários nomes (ex.: comunidades); cada um vira uma linha
 *   threshold?: number,
 *   overrides?: Record<string, 'region'|'properties'>,
 *   clientMapped?: boolean,
 *   propertyMapped?: boolean,
 * }} options
 * @returns {{
 *   items: Array<{unit:object, mode:'region'|'properties', automatic:boolean, clients:number,
 *                 countLabel:string, lines:string[], notes:string[]}>,
 *   lines: string[], notes: string[], pendingUnits: object[],
 * }}
 */
export function buildAnnouncement(units, points, {
  nameOf, namesOf = null, threshold = 3, overrides = {}, clientMapped = false, propertyMapped = false,
}) {
  const byUnit = new Map();
  (points ?? []).forEach((p) => {
    if (p.status !== 'matched' || !p.unitId) return;
    if (!byUnit.has(p.unitId)) byUnit.set(p.unitId, []);
    byUnit.get(p.unitId).push(p);
  });

  const pendingUnits = [];
  const regionLines = (u) => {
    const many = namesOf?.(u);
    if (many?.length) return many;
    const name = nameOf(u);
    if (name) return [name];
    pendingUnits.push(u);
    return [pendingRegionLabel(u)];
  };

  const items = (units ?? []).map((u) => {
    const pts = byUnit.get(u.id) ?? [];
    const clients = countClients(pts, clientMapped);
    const countLabel = `${clients} ${clientMapped ? 'cliente(s)' : 'ponto(s)'}`;
    const override = overrides[u.id];
    const wantsProperties = override ? override === ANNOUNCE_MODE.properties : clients < threshold;
    const notes = [];

    if (!wantsProperties) {
      return {
        unit: u, mode: ANNOUNCE_MODE.region, automatic: !override, clients, countLabel, lines: regionLines(u), notes,
      };
    }
    if (!propertyMapped) {
      notes.push(`Região ${num(u)}: ${countLabel}, mas o CSV não tem coluna de propriedade mapeada; a região foi citada.`);
      return {
        unit: u, mode: ANNOUNCE_MODE.region, automatic: !override, clients, countLabel, lines: regionLines(u), notes,
      };
    }

    const seen = new Set();
    const lines = [];
    let missing = 0;
    pts.forEach((p) => {
      const name = clean(p.property);
      if (!name || /[[\]]/.test(name)) { missing += 1; return; }
      const key = fold(name);
      if (!seen.has(key)) { seen.add(key); lines.push(name); }
    });
    if (missing) {
      notes.push(`Região ${num(u)}: ${missing} ponto(s) sem nome de propriedade no CSV; a região também foi citada para que ninguém fique sem aviso.`);
      lines.push(...regionLines(u));
    }
    return {
      unit: u, mode: ANNOUNCE_MODE.properties, automatic: !override, clients, countLabel, lines, notes,
    };
  });

  // Lista final da carta: na ordem das regiões, sem repetir nomes.
  const seen = new Set();
  const lines = [];
  items.forEach((it) => it.lines.forEach((l) => {
    const key = fold(l);
    if (!seen.has(key)) { seen.add(key); lines.push(l); }
  }));

  const notes = items.flatMap((it) => it.notes);
  const byProperty = items.filter((it) => it.mode === ANNOUNCE_MODE.properties);
  if (byProperty.length) {
    notes.unshift(`${byProperty.length} região(ões) citada(s) pelo nome das propriedades (menos de ${threshold} clientes ou escolha do operador): ${byProperty.map((it) => num(it.unit)).join(', ')}.`);
  }
  return {
    items, lines, notes, pendingUnits,
  };
}
