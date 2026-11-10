import { describe, expect, it, vi } from 'vitest';
import { LifeDataValidator } from '../../../src/domain/services';
import {
  DataLoadError,
  DEFAULT_URLS,
  HttpJsonTimelineRepository,
  type FetchLike,
} from '../../../src/infrastructure/http/HttpJsonTimelineRepository';
import { makeData } from '../../helpers/fixtures';

type Reply = { status: number; body?: unknown } | { throws: unknown } | { status: number; invalidJson: true };

function response(reply: Reply): Promise<Response> {
  if ('throws' in reply) return Promise.reject(reply.throws);
  const ok = reply.status >= 200 && reply.status < 300;
  const json =
    'invalidJson' in reply
      ? (): Promise<unknown> => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))
      : (): Promise<unknown> => Promise.resolve(reply.body);
  return Promise.resolve({ ok, status: reply.status, json } as Response);
}

/** fetch falso: responde por URL y registra las llamadas. */
function fakeFetch(routes: Record<string, Reply>): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>((url) => response(routes[url] ?? { status: 404 }));
}

const PRIMARY = DEFAULT_URLS.primary as string;
const FALLBACK = DEFAULT_URLS.fallback;

function example(): ReturnType<typeof makeData> {
  const data = makeData();
  data.meta.owner = 'Persona de ejemplo';
  return data;
}

function repository(routes: Record<string, Reply>, urls = DEFAULT_URLS): {
  repo: HttpJsonTimelineRepository;
  fetchFn: ReturnType<typeof fakeFetch>;
  warn: ReturnType<typeof vi.fn<(message: string) => void>>;
} {
  const fetchFn = fakeFetch(routes);
  const warn = vi.fn<(message: string) => void>();
  return { repo: new HttpJsonTimelineRepository(fetchFn, new LifeDataValidator(), urls, warn), fetchFn, warn };
}

describe('HttpJsonTimelineRepository', () => {
  it('URLs por defecto: /data/life.json y, de reserva, /data/life.example.json', () => {
    expect(DEFAULT_URLS).toEqual({ primary: '/data/life.json', fallback: '/data/life.example.json' });
  });

  it('200 con JSON válido: devuelve los datos personales sin tocar el ejemplo', async () => {
    const personal = makeData();
    const { repo, fetchFn, warn } = repository({ [PRIMARY]: { status: 200, body: personal }, [FALLBACK]: { status: 200, body: example() } });

    const loaded = await repo.load();

    expect(loaded).toEqual({ data: personal, source: 'personal' });
    expect(loaded.rejectedIssues).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(PRIMARY, { cache: 'no-cache', headers: { Accept: 'application/json' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('404 en el JSON personal: cae al de ejemplo en silencio', async () => {
    const { repo, fetchFn, warn } = repository({ [PRIMARY]: { status: 404 }, [FALLBACK]: { status: 200, body: example() } });

    const loaded = await repo.load();

    expect(loaded.source).toBe('example');
    expect(loaded.data.meta.owner).toBe('Persona de ejemplo');
    expect(loaded.rejectedIssues).toBeUndefined();
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual([PRIMARY, FALLBACK]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([[403], [500], [503]])('HTTP %i en el JSON personal: cae al de ejemplo', async (status) => {
    const { repo } = repository({ [PRIMARY]: { status }, [FALLBACK]: { status: 200, body: example() } });
    expect((await repo.load()).source).toBe('example');
  });

  it('JSON mal formado (p. ej. el index.html de una SPA): cae al de ejemplo', async () => {
    const { repo, warn } = repository({ [PRIMARY]: { status: 200, invalidJson: true }, [FALLBACK]: { status: 200, body: example() } });
    const loaded = await repo.load();
    expect(loaded.source).toBe('example');
    expect(loaded.rejectedIssues).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('JSON bien formado que NO valida: cae al de ejemplo, avisa y expone los errores', async () => {
    const broken = makeData() as unknown as { categories: { color: string }[]; events: { date: unknown }[] };
    broken.categories[0].color = 'azul';
    broken.events[0].date = { start: '2014', end: '2010' };
    const { repo, warn } = repository({ [PRIMARY]: { status: 200, body: broken }, [FALLBACK]: { status: 200, body: example() } });

    const loaded = await repo.load();

    expect(loaded.source).toBe('example');
    expect(loaded.data.meta.owner).toBe('Persona de ejemplo');
    expect(loaded.rejectedIssues?.map((issue) => issue.path)).toEqual(['categories[0].color', 'events[0].date.end']);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain('/data/life.json no es válido');
    expect(message).toContain('  - categories[0].color: "azul" debe ser un color hex #RRGGBB');
    expect(message).toContain('  - events[0].date.end:');
  });

  it.each([
    ['null', null],
    ['una lista', []],
    ['un texto', 'hola'],
  ])('un JSON personal que es %s no valida y cae al ejemplo', async (_label, body) => {
    const { repo, warn } = repository({ [PRIMARY]: { status: 200, body }, [FALLBACK]: { status: 200, body: example() } });
    const loaded = await repo.load();
    expect(loaded.source).toBe('example');
    expect(loaded.rejectedIssues).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('error de red en el JSON personal: cae al de ejemplo', async () => {
    const { repo } = repository({ [PRIMARY]: { throws: new TypeError('Failed to fetch') }, [FALLBACK]: { status: 200, body: example() } });
    expect((await repo.load()).source).toBe('example');
  });

  it('error de red en ambos: lanza DataLoadError con la causa', async () => {
    const { repo, fetchFn } = repository({
      [PRIMARY]: { throws: new TypeError('Failed to fetch') },
      [FALLBACK]: { throws: new TypeError('Failed to fetch') },
    });
    const error = await repo.load().then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).name).toBe('DataLoadError');
    expect((error as DataLoadError).message).toBe('No se han podido cargar los datos (/data/life.example.json: Failed to fetch).');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('un rechazo que no es Error se describe como "error de red"', async () => {
    const { repo } = repository({ [PRIMARY]: { throws: 'boom' }, [FALLBACK]: { throws: { code: 1 } } });
    await expect(repo.load()).rejects.toThrow('/data/life.example.json: error de red');
  });

  it('404 también en el ejemplo: DataLoadError con el código HTTP', async () => {
    const { repo } = repository({});
    await expect(repo.load()).rejects.toThrow('No se han podido cargar los datos (/data/life.example.json: HTTP 404).');
  });

  it('si el ejemplo tampoco valida: DataLoadError con el nº de errores (y sin avisar del personal)', async () => {
    const { repo, warn } = repository({ [PRIMARY]: { status: 404 }, [FALLBACK]: { status: 200, body: { schemaVersion: 1 } } });
    await expect(repo.load()).rejects.toThrow(/life\.example\.json: 3 errores de validación/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('primary = null (?example=1): va directo al ejemplo sin pedir el personal', async () => {
    const { repo, fetchFn, warn } = repository(
      { [PRIMARY]: { status: 200, body: makeData() }, [FALLBACK]: { status: 200, body: example() } },
      { primary: null, fallback: FALLBACK },
    );
    const loaded = await repo.load();
    expect(loaded.source).toBe('example');
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual([FALLBACK]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('admite URLs personalizadas', async () => {
    const { repo, fetchFn } = repository(
      { '/a.json': { status: 404 }, '/b.json': { status: 200, body: example() } },
      { primary: '/a.json', fallback: '/b.json' },
    );
    expect((await repo.load()).source).toBe('example');
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual(['/a.json', '/b.json']);
  });

  it('por defecto avisa con console.warn', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new HttpJsonTimelineRepository(
      fakeFetch({ [PRIMARY]: { status: 200, body: {} }, [FALLBACK]: { status: 200, body: example() } }),
      new LifeDataValidator(),
    );
    await repo.load();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0][0])).toContain('[timeline] /data/life.json no es válido');
  });
});
