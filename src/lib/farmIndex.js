/**
 * Índice de fazendas: liga o código CAR, o código INCRA, o nome da fazenda
 * (com o município) e o transformador a um ponto (lat/long).
 *
 * Usado para:
 *  - importar linhas SEM coordenada: o ponto vem da fazenda;
 *  - conferir linhas COM coordenada: o ponto informado deve ficar perto da
 *    fazenda citada na mesma linha;
 *  - mostrar a fazenda mais próxima de uma coordenada buscada no mapa.
 *
 * Dado: public/data/fazendas/indice_fazendas.json, gerado pelo script
 * MARATONA-TIVIT/scripts/comunidades/exportar_indice_fazendas.py a partir do
 * catálogo (CAR, INCRA/SIGEF, IBGE/CNEFE, BDGD). Só códigos públicos e nomes
 * da fonte; nenhum dado de cliente.
 *
 * Regra de busca (a primeira que identificar UMA fazenda vence):
 *  1. ID do catálogo ("3115300-00001");
 *  2. código CAR (com ou sem pontos; inclui cadastros repetidos do imóvel);
 *  3. código INCRA (só dígitos);
 *  4. nome da fazenda + município (sem acento/maiúsculas; "Fazenda", "Sítio"…
 *     opcionais). Sem município, só vale se o nome for único na área;
 *  5. transformador, quando ele atende uma única fazenda.
 * Mais de uma fazenda possível → não escolhe: devolve os candidatos para revisão.
 */

export const FARM_INDEX_URL = '/data/fazendas/indice_fazendas.json';
/** Distância a partir da qual um ponto do arquivo é sinalizado como longe da fazenda citada. */
export const FARM_FAR_METERS = 3000;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const PREFIXES = /^(fazenda|faz|sitio|sit|chacara|chac|granja|estancia|rancho|recanto|propriedade|imovel|gleba)\s+/;
/** Nome sem o tipo do imóvel e sem artigos iniciais: "Fazenda da Contenda" → "contenda". */
export const nameCore = (s) => fold(s).replace(PREFIXES, '').replace(/^(d[aeo]s?|n[ao]s?)\s+/, '').trim();

export const normalizeCar = (s) => String(s ?? '').toUpperCase().replace(/[\s.]/g, '');
export const normalizeIncra = (s) => String(s ?? '').replace(/\D/g, '');
const UF_BY_PREFIX = { 31: 'MG', 33: 'RJ', 32: 'ES', 35: 'SP' };

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const distanceMeters = haversine;

const push = (map, key, value) => {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * Monta o índice a partir do JSON colunar.
 * @returns {{ size, municipalities, find, nearest, describe }}
 */
export function createFarmIndex(raw) {
  const cols = Object.fromEntries((raw?.campos ?? []).map((c, i) => [c, i]));
  const municipalities = new Map(Object.entries(raw?.municipios ?? {}));
  const munByName = new Map([...municipalities].map(([cod, nome]) => [fold(nome), cod]));

  const farms = (raw?.fazendas ?? []).map((row) => {
    const mun = row[cols.mun];
    const carShort = row[cols.car];
    const uf = UF_BY_PREFIX[String(mun).slice(0, 2)] ?? '';
    const car = carShort && !carShort.includes('-') ? `${uf}-${mun}-${carShort}` : carShort;
    return {
      id: `${mun}-${row[cols.id]}`,
      mun,
      municipio: municipalities.get(mun) ?? mun,
      nome: row[cols.nome] || null,
      car: car || null,
      incra: row[cols.incra] || null,
      lat: row[cols.lat],
      lng: row[cols.lon],
      trafos: row[cols.trafos] ? row[cols.trafos].split(/\s*,\s*/).filter(Boolean) : [],
      carRep: row[cols.carRep] ? row[cols.carRep].split(/\s*,\s*/).filter(Boolean) : [],
    };
  });

  const byId = new Map();
  const byCar = new Map();
  const byIncra = new Map();
  const byName = new Map(); // "mun|nome completo" e "mun|núcleo"
  const byNameAnyMun = new Map();
  const byTrafo = new Map();
  farms.forEach((f) => {
    byId.set(f.id, f);
    [f.car, ...f.carRep].forEach((c) => push(byCar, normalizeCar(c), f));
    push(byIncra, normalizeIncra(f.incra), f);
    if (f.nome) {
      const full = fold(f.nome);
      const core = nameCore(f.nome);
      push(byName, `${f.mun}|${full}`, f);
      if (core && core !== full) push(byName, `${f.mun}|${core}`, f);
      push(byNameAnyMun, full, f);
      if (core && core !== full) push(byNameAnyMun, core, f);
    }
    f.trafos.forEach((t) => push(byTrafo, t, f));
  });

  /** Código IBGE a partir do texto do arquivo (código de 7 dígitos ou nome, com ou sem "/UF"). */
  const resolveMunicipality = (text) => {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const digits = t.replace(/\D/g, '');
    if (digits.length === 7 && municipalities.has(digits)) return digits;
    return munByName.get(fold(t.replace(/\s*[-/]\s*[A-Za-z]{2}$/, ''))) ?? null;
  };

  const uniq = (list) => [...new Map((list ?? []).map((f) => [f.id, f])).values()];

  /**
   * Procura a fazenda de uma linha.
   * @param {{ catalogId?, car?, incra?, property?, municipality?, equipment? }} keys
   * @returns {{ farm, method, candidates: object[], tried: string[] }}
   *   farm: a fazenda identificada (ou null); candidates: possíveis, quando ambíguo.
   */
  function find(keys = {}) {
    const tried = [];
    const pick = (method, list) => {
      const found = uniq(list);
      if (found.length === 1) return { farm: found[0], method, candidates: found, tried };
      if (found.length > 1) return { farm: null, method, candidates: found, tried };
      return null;
    };
    let ambiguous = null;
    const attempt = (method, list) => {
      tried.push(method);
      const r = pick(method, list);
      if (r?.farm) return r;
      if (r && !ambiguous) ambiguous = r;
      return null;
    };

    const munCode = resolveMunicipality(keys.municipality);
    const steps = [
      keys.catalogId && (() => attempt('catalogo', [byId.get(String(keys.catalogId).trim())].filter(Boolean))),
      keys.car && (() => attempt('car', byCar.get(normalizeCar(keys.car)))),
      keys.incra && normalizeIncra(keys.incra).length >= 8 && (() => attempt('incra', byIncra.get(normalizeIncra(keys.incra)))),
      keys.property && (() => {
        const full = fold(keys.property);
        const core = nameCore(keys.property);
        if (munCode) {
          return attempt('nome', byName.get(`${munCode}|${full}`)) ?? attempt('nome', byName.get(`${munCode}|${core}`));
        }
        return attempt('nome', byNameAnyMun.get(full)) ?? attempt('nome', byNameAnyMun.get(core));
      }),
      keys.equipment && (() => {
        const list = String(keys.equipment).split(/\s*[,;/]\s*/).flatMap((t) => byTrafo.get(t.trim()) ?? []);
        return attempt('transformador', munCode ? list.filter((f) => f.mun === munCode) : list);
      }),
    ].filter(Boolean);

    for (const step of steps) {
      const r = step();
      if (r) return r;
    }
    return ambiguous ? { ...ambiguous, tried } : { farm: null, method: null, candidates: [], tried };
  }

  /** Fazenda mais próxima de um ponto (até maxMeters). Busca linear; o índice tem ~80 mil pontos. */
  function nearest(lat, lng, maxMeters = 500) {
    const dLat = maxMeters / 110540;
    const dLng = maxMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    let best = null;
    let bestD = Infinity;
    farms.forEach((f) => {
      if (Math.abs(f.lat - lat) > dLat || Math.abs(f.lng - lng) > dLng) return;
      const d = haversine(lat, lng, f.lat, f.lng);
      if (d < bestD) { best = f; bestD = d; }
    });
    return best && bestD <= maxMeters ? { farm: best, meters: bestD } : null;
  }

  return {
    size: farms.length,
    municipalities,
    resolveMunicipality,
    find,
    nearest,
  };
}

export const METHOD_TEXT = {
  catalogo: 'ID do catálogo',
  car: 'código CAR',
  incra: 'código INCRA',
  nome: 'nome da fazenda',
  transformador: 'transformador',
};

/** Texto curto de uma fazenda: "Sítio Jaboticabeira (Cataguases) · CAR MG-3115300-…". */
export function describeFarm(f) {
  if (!f) return '';
  const code = f.car ? `CAR ${f.car}` : f.incra ? `INCRA ${f.incra}` : `catálogo ${f.id}`;
  return `${f.nome ?? 'Fazenda sem nome'} (${f.municipio}) · ${code}`;
}

let cache = null;
/** Carrega o índice uma vez por sessão (só quando algo precisa dele). */
export function loadFarmIndex(url = FARM_INDEX_URL, { fetchImpl = fetch } = {}) {
  if (!cache) {
    cache = fetchImpl(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Índice de fazendas indisponível (HTTP ${res.status}).`);
        return res.json();
      })
      .then(createFarmIndex)
      .catch((err) => { cache = null; throw err; });
  }
  return cache;
}
