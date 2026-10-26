/**
 * Fatos do histórico de desligamentos (sem IA, sem dado de cliente).
 *
 * Recebe o desligamento em análise e os registros salvos e devolve números
 * e alertas, cada um com as referências (ordem e data) de onde saiu. É a
 * base do parecer: a próxima etapa é a IA escrever o texto a partir destes
 * fatos, sem calcular nada por conta própria.
 */

export const WINDOW_RECENT_DAYS = 30;
export const WINDOW_LONG_DAYS = 90;
/** Outro desligamento nas mesmas comunidades até este número de dias de distância: dá para agrupar. */
export const GROUPING_DAYS = 15;
/** A partir deste número de desligamentos anteriores em 30 dias, a comunidade entra como recorrente. */
export const RECURRENT_MIN = 2;
/** A partir deste número de desligamentos no mesmo alimentador em 90 dias. */
export const FEEDER_RECURRENT_MIN = 3;

const DAY = 86400000;
const LEVELS = { alta: 3, media: 2, info: 1 };

/** "2026-10-20" → milissegundos (meia-noite UTC) ou null. */
export function dayMs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const minutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Duração em horas (uma casa decimal) ou null. Com datas diferentes, atravessa a meia-noite. */
export function durationHours(start, end, date = null, endDate = null) {
  const s = minutes(start);
  const e = minutes(end);
  if (s == null || e == null) return null;
  const days = date && endDate && endDate !== date ? (dayMs(endDate) - dayMs(date)) / DAY : 0;
  const total = days * 1440 + e - s;
  return Number.isFinite(total) && total > 0 ? Math.round((total / 60) * 10) / 10 : null;
}

const joinNames = (names) => (names.length <= 3
  ? names.join(', ').replace(/, ([^,]*)$/, ' e $1')
  : `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`);
/** "Palmeiras (distrito de Leopoldina)": nome da comunidade com o distrito, quando gravado. */
export const communityLabel = (c) => (c?.distrito ? `${c.nome} (distrito de ${c.distrito})` : c?.nome ?? '');

/** Registros antigos (antes do tipo) contam como programados. */
export const typeOf = (r) => (r?.tipo === 'acidental' ? 'acidental' : 'programado');
export const SCOPES = [
  { value: 'todos', label: 'Todos' },
  { value: 'programado', label: 'Programado' },
  { value: 'acidental', label: 'Acidental' },
];
const inScope = (scope) => (r) => scope === 'todos' || typeOf(r) === scope;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "; antes deste: 2 programados e 1 acidental" — só quando há os dois tipos. */
const breakdown = (list) => {
  const a = list.filter((r) => typeOf(r) === 'acidental').length;
  const p = list.length - a;
  return a && p ? `; antes deste: ${plural(p, 'programado', 'programados')} e ${plural(a, 'acidental', 'acidentais')}` : '';
};
const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : 'sem data');
const fmtH = (h) => `${String(h).replace('.', ',')}h`;

/** Referência curta a um registro: "OS-1234 (05/11)". */
export function refOf(r) {
  return {
    id: r.id,
    label: `${r.ordem || 'sem ordem'} (${dateBr(r.data).slice(0, 5)})`,
    ordem: r.ordem || null,
    tipo: typeOf(r),
    data: r.data,
    inicio: r.inicio,
    termino: r.termino,
  };
}

const overlaps = (a, b) => {
  const as = minutes(a.inicio); const ae = minutes(a.termino);
  const bs = minutes(b.inicio); const be = minutes(b.termino);
  if ([as, ae, bs, be].some((x) => x == null)) return true; // sem horário: trata como conflito possível
  return as < be && bs < ae;
};

/**
 * @param {object} current desligamento em análise (mesmo formato do registro salvo)
 * @param {object[]} history registros salvos
 */
export function computeFacts(current, history, { scope = 'todos' } = {}) {
  const all = (history ?? []).filter((r) => r.id !== current.id && r.status !== 'cancelado');
  const counts = {
    todos: all.length,
    programado: all.filter((r) => typeOf(r) === 'programado').length,
    acidental: all.filter((r) => typeOf(r) === 'acidental').length,
  };
  const others = all.filter(inScope(scope));
  const currentType = typeOf(current);
  const day = dayMs(current.data);
  const communities = current.comunidades ?? [];
  const alerts = [];

  const byCommunity = communities.map((c) => {
    const touching = others.filter((r) => r.comunidades?.some((x) => x.key === c.key));
    const dated = touching.filter((r) => dayMs(r.data) != null);
    const before = (days) => (day == null ? [] : dated.filter((r) => {
      const d = dayMs(r.data);
      return d < day && d >= day - days * DAY;
    }));
    const recent = before(WINDOW_RECENT_DAYS);
    const long = before(WINDOW_LONG_DAYS);
    const hours90 = long.reduce((s, r) => s + (r.duracaoH ?? 0), 0);
    const last = day == null ? null : dated.filter((r) => dayMs(r.data) < day).sort((a, b) => dayMs(b.data) - dayMs(a.data))[0] ?? null;
    const near = day == null ? [] : dated.filter((r) => {
      const d = dayMs(r.data);
      return d !== day && Math.abs(d - day) <= GROUPING_DAYS * DAY;
    });
    const sameDay = day == null ? [] : dated.filter((r) => dayMs(r.data) === day && overlaps(r, current));
    return {
      key: c.key,
      nome: communityLabel(c),
      pontos: c.pontos,
      total: touching.length,
      recent: recent.map(refOf),
      long: long.map(refOf),
      recentRaw: recent,
      acid90: long.filter((r) => typeOf(r) === 'acidental').length,
      hours90: Math.round(hours90 * 10) / 10,
      last: last ? { ...refOf(last), daysAgo: Math.round((day - dayMs(last.data)) / DAY) } : null,
      // Agrupar serviços só vale entre desligamentos programados.
      near: currentType === 'programado' ? near.filter((r) => typeOf(r) === 'programado').map(refOf) : [],
      sameDay: sameDay.map(refOf),
    };
  });

  // Alertas por comunidade; comunidades com o mesmo alerta e as mesmas referências viram uma linha só.
  const perCommunity = new Map();
  const addFor = (c, level, tail, refs) => {
    const key = `${level}|${tail}|${refs.map((r) => r.id).sort().join(',')}`;
    if (!perCommunity.has(key)) perCommunity.set(key, { level, tail, refs, names: [] });
    perCommunity.get(key).names.push(c.nome);
  };
  byCommunity.forEach((c) => {
    if (c.sameDay.length) addFor(c, 'alta', 'já existe desligamento registrado no mesmo dia e horário.', c.sameDay);
    if (c.recent.length >= RECURRENT_MIN) {
      addFor(c, 'alta', `este ${currentType === 'acidental' ? 'é' : 'será'} o ${c.recent.length + 1}º desligamento em ${WINDOW_RECENT_DAYS} dias`
        + breakdown(c.recentRaw)
        + `${c.hours90 ? `, com ${fmtH(c.hours90)} sem energia nos últimos ${WINDOW_LONG_DAYS} dias` : ''}.`, c.recent);
    } else if (c.recent.length === 1) {
      addFor(c, 'media', `teve desligamento ${c.recent[0].tipo} há ${Math.round((day - dayMs(c.recent[0].data)) / DAY)} dia(s).`, c.recent);
    }
    const groupable = c.near.filter((r) => !c.sameDay.some((s) => s.id === r.id));
    if (groupable.length) {
      addFor(c, 'media', `há outro desligamento a menos de ${GROUPING_DAYS} dias. Avaliar agrupar os serviços em uma única parada.`, groupable);
    }
  });
  perCommunity.forEach(({ level, tail, refs, names }) => {
    alerts.push({ level, text: `${joinNames(names)}: ${tail}`, refs });
  });

  // Causa recorrente (acidentais): mesma causa nas mesmas comunidades em 90 dias.
  const cause = current.motivo?.trim().toLowerCase();
  if (currentType === 'acidental' && cause && day != null) {
    const keys = new Set(communities.map((c) => c.key));
    const same = others.filter((r) => typeOf(r) === 'acidental' && r.motivo?.trim().toLowerCase() === cause
      && dayMs(r.data) != null && dayMs(r.data) < day && dayMs(r.data) >= day - WINDOW_LONG_DAYS * DAY
      && r.comunidades?.some((x) => keys.has(x.key)));
    if (same.length) {
      alerts.push({
        level: 'alta',
        text: `Causa recorrente: "${current.motivo.trim()}" ${same.length + 1} vezes em ${WINDOW_LONG_DAYS} dias nestas comunidades.`
          + `${/árvore|galho/i.test(current.motivo) ? ' Avaliar poda preventiva em um desligamento programado.' : ' Avaliar ação preventiva na rede.'}`,
        refs: same.map(refOf),
      });
    }
  }

  // Alimentador
  let feeder = null;
  const feederKey = current.alimentador?.trim().toUpperCase();
  if (feederKey && day != null) {
    const same = others.filter((r) => r.alimentador?.trim().toUpperCase() === feederKey && dayMs(r.data) != null
      && dayMs(r.data) < day && dayMs(r.data) >= day - WINDOW_LONG_DAYS * DAY);
    feeder = { name: current.alimentador.trim(), count: same.length, refs: same.map(refOf) };
    if (same.length + 1 >= FEEDER_RECURRENT_MIN) {
      alerts.push({
        level: 'media',
        text: `Alimentador ${feeder.name}: ${same.length + 1} desligamentos em ${WINDOW_LONG_DAYS} dias, contando este${breakdown(same)}. Pode indicar problema recorrente na rede.`,
        refs: feeder.refs,
      });
    }
  }

  // Antecedência do aviso (só entre programados: acidental não tem aviso prévio)
  const notices = others.filter((r) => typeOf(r) === 'programado').map((r) => r.antecedenciaDias).filter((n) => Number.isFinite(n) && n >= 0);
  const avgNotice = notices.length ? Math.round((notices.reduce((s, n) => s + n, 0) / notices.length) * 10) / 10 : null;
  if (currentType === 'programado' && Number.isFinite(current.antecedenciaDias) && avgNotice != null && current.antecedenciaDias < avgNotice) {
    alerts.push({
      level: 'info',
      text: `Aviso com ${current.antecedenciaDias} dia(s) de antecedência, abaixo da média registrada (${String(avgNotice).replace('.', ',')} dias).`,
      refs: [],
    });
  }

  if (!others.length) {
    alerts.push({
      level: 'info',
      text: scope === 'todos'
        ? 'Primeiro desligamento no histórico: as análises passam a valer a partir dos próximos registros.'
        : `Nenhum desligamento ${scope} no histórico ainda.`,
      refs: [],
    });
  } else if (!alerts.length) {
    alerts.push({ level: 'info', text: 'Nenhuma recorrência ou conflito encontrado no histórico para estas comunidades.', refs: [] });
  }

  alerts.sort((a, b) => LEVELS[b.level] - LEVELS[a.level]);
  const level = alerts.reduce((m, a) => (LEVELS[a.level] > LEVELS[m] ? a.level : m), 'info');

  return {
    scope,
    counts,
    historyCount: others.length,
    level,
    alerts,
    byCommunity,
    feeder,
    avgNotice,
  };
}

/** Monta o registro a partir do formulário e das regiões selecionadas. */
export function buildOutageRecord({
  id, form, outageView, units, nameOf, keyOf, mode, by,
}) {
  const comunidades = units.map((u) => ({
    key: keyOf(u),
    nome: nameOf(u) || u.label || u.code || u.id,
    distrito: (u.distritos ?? []).map((d) => d.nome).join(', ') || null,
    municipio: u.municipio?.nome ?? null,
    pontos: u.count ?? 0,
  }));
  return {
    id,
    mode,
    tipo: form.type === 'acidental' ? 'acidental' : 'programado',
    ordem: form.orderId?.trim() || null,
    alimentador: form.feeder?.trim() || null,
    motivo: form.reason?.trim() || null,
    data: form.date || null,
    inicio: form.start || null,
    termino: form.end || null,
    dataFim: form.type === 'acidental' ? (form.endDate || form.date || null) : (form.date || null),
    duracaoH: durationHours(form.start, form.end, form.date, form.type === 'acidental' ? form.endDate : null),
    equipamento: form.type === 'acidental' ? (form.device?.trim() || null) : null,
    observacoes: form.type === 'acidental' ? (form.notes?.trim() || null) : null,
    dataAviso: form.type === 'acidental' ? null : (form.noticeDate || null),
    antecedenciaDias: outageView?.noticeDaysBefore ?? null,
    comunidades,
    totalPontos: comunidades.reduce((s, c) => s + c.pontos, 0),
    status: form.type === 'acidental' ? 'registrado' : 'aprovado',
    savedBy: by || null,
    savedAt: new Date().toISOString(),
  };
}
