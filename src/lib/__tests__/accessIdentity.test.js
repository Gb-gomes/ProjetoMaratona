import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { fetchAccessIdentity, parseIdentity, ACCESS_IDENTITY_URL } from '../accessIdentity.js';

const response = ({ status = 200, type = 'application/json', body = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  text: async () => body,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchAccessIdentity', () => {
  it('retorna e-mail e nome em caso de sucesso, consultando a mesma origem', async () => {
    const fetchImpl = vi.fn(async () => response({
      body: JSON.stringify({ email: ' Fulana@Energisa.com.br ', name: 'Fulana de Tal', idp: { type: 'onetimepin' } }),
    }));
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toEqual({ email: 'fulana@energisa.com.br', name: 'Fulana de Tal' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ACCESS_IDENTITY_URL);
    expect(init.credentials).toBe('same-origin');
  });

  it('aceita identidade sem nome', async () => {
    const fetchImpl = async () => response({ body: '{"email":"a@energisa.com.br"}' });
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toEqual({ email: 'a@energisa.com.br', name: null });
  });

  it('retorna null para 404 (desenvolvimento local)', async () => {
    const fetchImpl = async () => response({ status: 404, type: 'text/plain', body: 'Not Found' });
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toBeNull();
  });

  it('retorna null quando a resposta é HTML (fallback do Vite)', async () => {
    const fetchImpl = async () => response({ type: 'text/html; charset=utf-8', body: '<!doctype html><html></html>' });
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toBeNull();
  });

  it('retorna null para JSON inválido', async () => {
    const fetchImpl = async () => response({ body: '{"email": ' });
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toBeNull();
  });

  it('retorna null para JSON sem e-mail válido', async () => {
    const fetchImpl = async () => response({ body: '{"err":"no identity"}' });
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toBeNull();
  });

  it('retorna null em erro de rede, sem lançar', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    await expect(fetchAccessIdentity({ fetchImpl })).resolves.toBeNull();
  });

  it('retorna null no timeout e aborta a requisição', async () => {
    vi.useFakeTimers();
    let signal;
    const fetchImpl = vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}); });
    const promise = fetchAccessIdentity({ fetchImpl, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it('não escreve nada no console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await fetchAccessIdentity({ fetchImpl: async () => response({ body: '{"email":"a@energisa.com.br"}' }) });
    await fetchAccessIdentity({ fetchImpl: async () => { throw new Error('x'); } });
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it('retorna null sem fetch disponível', async () => {
    await expect(fetchAccessIdentity({ fetchImpl: null })).resolves.toBeNull();
  });
});

describe('parseIdentity', () => {
  it('rejeita valores que não são objetos ou e-mails', () => {
    expect(parseIdentity(null)).toBeNull();
    expect(parseIdentity([])).toBeNull();
    expect(parseIdentity({ email: 'sem-arroba' })).toBeNull();
    expect(parseIdentity({ email: 42 })).toBeNull();
  });
});
