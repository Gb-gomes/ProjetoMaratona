/**
 * Leitor de .dbf (atributos do Shapefile), rápido o bastante para centenas
 * de milhares de registros.
 *
 * Codificação: a do .cpg, se houver; senão UTF-8 se o arquivo for UTF-8
 * válido, e Windows-1252 caso contrário (comum em shapefiles brasileiros).
 */

function encodingFromCpg(cpg) {
  const t = String(cpg ?? '').trim().toUpperCase();
  if (!t) return null;
  if (/UTF-?8/.test(t)) return 'utf-8';
  const cp = /(?:ANSI\s*|CP|WINDOWS-?)?(\d{3,4})/.exec(t)?.[1];
  if (cp === '1252' || cp === '1250' || cp === '1251') return `windows-${cp}`;
  if (/8859-?1|LATIN-?1/.test(t)) return 'iso-8859-1';
  return null;
}

/**
 * @param {Uint8Array} bytes conteúdo do .dbf
 * @param {string} [cpg] conteúdo do .cpg
 * @returns {{ rows: object[], fields: {name,type,len,dec}[], encoding: string }}
 */
export function readDbf(bytes, cpg) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const nRecords = view.getUint32(4, true);
  const headLen = view.getUint16(8, true);
  const recLen = view.getUint16(10, true);
  const ascii = new TextDecoder('latin1');

  const fields = [];
  for (let o = 32; o + 32 <= headLen && u8[o] !== 0x0d; o += 32) {
    const nameBytes = u8.subarray(o, o + 11);
    const end = nameBytes.indexOf(0);
    fields.push({
      name: ascii.decode(end >= 0 ? nameBytes.subarray(0, end) : nameBytes).trim(),
      type: String.fromCharCode(u8[o + 11]),
      len: u8[o + 16],
      dec: u8[o + 17],
    });
  }
  let offset = 1;
  fields.forEach((f) => { f.offset = offset; offset += f.len; });

  let encoding = encodingFromCpg(cpg);
  const body = u8.subarray(headLen, headLen + nRecords * recLen);
  if (!encoding) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(body);
      encoding = 'utf-8';
    } catch {
      encoding = 'windows-1252';
    }
  }
  const decoder = new TextDecoder(encoding);

  const rows = new Array(nRecords);
  for (let r = 0; r < nRecords; r += 1) {
    const base = headLen + r * recLen;
    const row = {};
    for (let k = 0; k < fields.length; k += 1) {
      const f = fields[k];
      const start = base + f.offset;
      let s = start;
      let e = start + f.len;
      // Recorte de espaços e nulos sem criar strings intermediárias.
      while (s < e && (u8[s] === 0x20 || u8[s] === 0)) s += 1;
      while (e > s && (u8[e - 1] === 0x20 || u8[e - 1] === 0)) e -= 1;
      if (s === e) { row[f.name] = null; continue; }
      let ascii7 = true;
      for (let i = s; i < e; i += 1) if (u8[i] > 0x7f) { ascii7 = false; break; }
      const text = ascii7 ? String.fromCharCode.apply(null, u8.subarray(s, e)) : decoder.decode(u8.subarray(s, e));
      switch (f.type) {
        case 'N':
        case 'F': {
          const n = Number(text.replace(',', '.'));
          row[f.name] = Number.isFinite(n) ? n : null;
          break;
        }
        case 'L':
          row[f.name] = /^[YyTt]$/.test(text) ? true : /^[NnFf]$/.test(text) ? false : null;
          break;
        case 'D':
          row[f.name] = /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
          break;
        default:
          row[f.name] = text;
      }
    }
    rows[r] = row;
  }
  return { rows, fields, encoding };
}
