/**
 * Pontos inseridos à mão (lat/long digitados, ou só o CAR da fazenda) entram
 * na MESMA validação do arquivo: viram linhas extras da tabela, marcadas com
 * a linha "M1", "M2"… Assim passam pelas mesmas regras (coordenada,
 * duplicidade, fazenda) e pelo mesmo cruzamento.
 *
 * Sem arquivo, os pontos manuais formam uma tabela própria.
 */

export const MANUAL_FIELDS = [
  { key: 'id', label: 'Identificador' },
  { key: 'lat', label: 'Latitude' },
  { key: 'lng', label: 'Longitude' },
  { key: 'client', label: 'Cliente / UC' },
  { key: 'property', label: 'Propriedade / fazenda' },
  { key: 'car', label: 'Código CAR' },
];

export const MANUAL_FILE_NAME = 'Pontos inseridos manualmente';
export const isManualLine = (line) => typeof line === 'string' && /^M\d+$/.test(line);
/** "Linha 12" ou "Ponto inserido 2". */
export const lineLabel = (line) => (isManualLine(line) ? `Ponto inserido ${line.slice(1)}` : `Linha ${line}`);

const text = (v) => (v == null ? '' : String(v).trim());

/**
 * @param {{headers, rows, rowLines}|null} parsed tabela do arquivo (ou null)
 * @param {Record<string, number|null>} mapping mapeamento do arquivo
 * @param {object[]} manual pontos inseridos ({ lat, lng, id, client, property, car })
 * @returns {{ parsed, mapping }} tabela e mapeamento com as linhas manuais
 */
export function withManualPoints(parsed, mapping, manual = []) {
  if (!manual.length) return { parsed, mapping };
  const headers = [...(parsed?.headers ?? [])];
  const map = { ...(parsed ? mapping : {}) };
  // Campos usados pelos pontos manuais que o arquivo não tem: coluna nova, só nesta validação.
  MANUAL_FIELDS.forEach(({ key, label }) => {
    if (map[key] != null) return;
    if (!manual.some((p) => text(p[key]) !== '')) return;
    map[key] = headers.length;
    headers.push(parsed ? `${label} (inserido)` : label);
  });
  const width = headers.length;
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const extra = manual.map((p) => {
    const row = Array(width).fill('');
    MANUAL_FIELDS.forEach(({ key }) => { if (map[key] != null) row[map[key]] = text(p[key]); });
    return row;
  });
  return {
    parsed: {
      ...(parsed ?? {}),
      headers,
      rows: [...(parsed?.rows ?? []).map(pad), ...extra],
      rowLines: [...(parsed?.rowLines ?? []), ...manual.map((_, i) => `M${i + 1}`)],
    },
    mapping: map,
  };
}
