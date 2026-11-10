import { describe, expect, it } from 'vitest';
import { ValidationError, type ValidationIssue } from '../../../src/domain/errors';
import { LifeDataValidator } from '../../../src/domain/services';
import { makeData, makeEvent } from '../../helpers/fixtures';

type Loose = {
  schemaVersion: unknown;
  meta: Record<string, unknown>;
  categories: Record<string, unknown>[];
  events: Record<string, unknown>[];
} & Record<string, unknown>;

const validator = new LifeDataValidator();

/** Valida una copia de los datos válidos tras aplicarle una mutación. */
function issuesAfter(mutate: (data: Loose) => void): readonly ValidationIssue[] {
  const data = makeData() as unknown as Loose;
  mutate(data);
  return validator.validate(data).issues;
}

function expectSingleIssue(mutate: (data: Loose) => void, path: string, message: RegExp): void {
  const issues = issuesAfter(mutate);
  expect(issues.map((issue) => issue.path)).toEqual([path]);
  expect(issues[0].message).toMatch(message);
}

describe('LifeDataValidator: documento válido', () => {
  it('acepta los datos de referencia y devuelve el mismo objeto tipado', () => {
    const data = makeData();
    const result = validator.validate(data);
    expect(result).toEqual({ ok: true, issues: [], data });
    expect(result.data).toBe(data);
  });

  it('assertValid devuelve los datos si son válidos', () => {
    const data = makeData();
    expect(validator.assertValid(data)).toBe(data);
  });

  it('acepta un documento mínimo sin eventos ni campos opcionales', () => {
    const result = validator.validate({
      schemaVersion: 1,
      meta: { owner: 'A', title: 'B', locale: 'es' },
      categories: [{ id: 'c1', label: 'C', color: '#abcdef' }],
      events: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe('LifeDataValidator: raíz y meta', () => {
  it.each([[null], [undefined], ['texto'], [42], [[]], [[{ schemaVersion: 1 }]]])(
    'rechaza un documento que no es un objeto (%j) con ruta vacía',
    (input) => {
      const result = validator.validate(input);
      expect(result.ok).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.issues).toEqual([{ path: '', message: 'el documento debe ser un objeto JSON' }]);
    },
  );

  it.each([[2], ['1'], [undefined], [null]])('schemaVersion debe ser exactamente 1 (%j)', (version) => {
    expectSingleIssue((data) => (data.schemaVersion = version), 'schemaVersion', /debe ser 1/);
  });

  it('meta es obligatorio y debe ser un objeto', () => {
    expectSingleIssue((data) => delete (data as Record<string, unknown>).meta, 'meta', /obligatorio/);
    expectSingleIssue((data) => ((data as Record<string, unknown>).meta = ['x']), 'meta', /objeto/);
  });

  it.each(['owner', 'title', 'locale'])('meta.%s es obligatorio y no puede estar en blanco', (key) => {
    expectSingleIssue((data) => delete data.meta[key], `meta.${key}`, /obligatorio/);
    expectSingleIssue((data) => (data.meta[key] = '   '), `meta.${key}`, /no vacío/);
    expectSingleIssue((data) => (data.meta[key] = 7), `meta.${key}`, /texto/);
  });

  it('meta.tagline es opcional pero debe ser texto', () => {
    expect(issuesAfter((data) => delete data.meta.tagline)).toEqual([]);
    expectSingleIssue((data) => (data.meta.tagline = 5), 'meta.tagline', /debe ser un texto/);
  });

  it('meta.contact: lista de enlaces http(s) con etiqueta', () => {
    expect(issuesAfter((data) => delete data.meta.contact)).toEqual([]);
    expectSingleIssue((data) => (data.meta.contact = 'x'), 'meta.contact', /lista de enlaces/);
    expectSingleIssue((data) => (data.meta.contact = ['x']), 'meta.contact[0]', /objeto/);
    expectSingleIssue(
      (data) => (data.meta.contact = [{ label: 'ok', url: 'https://example.com' }, { url: 'https://example.com' }]),
      'meta.contact[1].label',
      /obligatorio/,
    );
    expectSingleIssue(
      (data) => (data.meta.contact = [{ label: 'x', url: 'javascript:alert(1)' }]),
      'meta.contact[0].url',
      /http\(s\)/,
    );
    expectSingleIssue((data) => (data.meta.contact = [{ label: 'x' }]), 'meta.contact[0].url', /obligatorio/);
  });
});

describe('LifeDataValidator: categorías', () => {
  it.each([[undefined], [[]], ['work'], [{ id: 'work' }]])('exige una lista con al menos una categoría (%j)', (value) => {
    const issues = issuesAfter((data) => ((data as Record<string, unknown>).categories = value));
    expect(issues[0]).toEqual({ path: 'categories', message: 'debe ser una lista con al menos una categoría' });
  });

  it('cada categoría debe ser un objeto', () => {
    const issues = issuesAfter((data) => (data.categories[1] = 'study' as unknown as Record<string, unknown>));
    expect(issues.map((issue) => issue.path)).toContain('categories[1]');
  });

  it('id en kebab-case', () => {
    expectSingleIssue(
      (data) => {
        data.categories.push({ id: 'No Kebab', label: 'X', color: '#000000' });
      },
      'categories[3].id',
      /kebab-case/,
    );
    for (const id of ['-a', 'a-', 'a--b', 'a_b', 'Á']) {
      const issues = issuesAfter((data) => data.categories.push({ id, label: 'X', color: '#000000' }));
      expect(issues.map((issue) => issue.path)).toEqual(['categories[3].id']);
    }
    expect(issuesAfter((data) => data.categories.push({ id: 'a1-b2-c3', label: 'X', color: '#000000' }))).toEqual([]);
  });

  it('ids únicos: señala el duplicado, no el original', () => {
    expectSingleIssue(
      (data) => data.categories.push({ id: 'work', label: 'Otra', color: '#000000' }),
      'categories[3].id',
      /id duplicado "work"/,
    );
  });

  it('label obligatorio', () => {
    expectSingleIssue((data) => delete data.categories[0].label, 'categories[0].label', /obligatorio/);
  });

  it.each([['azul'], ['#fff'], ['#GGGGGG'], ['FFB454'], ['#FFB45400'], ['rgb(0,0,0)']])('color %s no es #RRGGBB', (color) => {
    expectSingleIssue((data) => (data.categories[2].color = color), 'categories[2].color', /color hex #RRGGBB/);
  });

  it('color admite mayúsculas y minúsculas; si falta, un único error', () => {
    expect(issuesAfter((data) => (data.categories[0].color = '#aBcDeF'))).toEqual([]);
    expectSingleIssue((data) => delete data.categories[0].color, 'categories[0].color', /obligatorio/);
  });

  it('icon y description son opcionales pero de texto', () => {
    expectSingleIssue((data) => (data.categories[0].icon = 1), 'categories[0].icon', /texto/);
    expectSingleIssue((data) => (data.categories[0].description = {}), 'categories[0].description', /texto/);
  });
});

describe('LifeDataValidator: eventos', () => {
  it('events debe ser una lista', () => {
    expectSingleIssue((data) => delete (data as Record<string, unknown>).events, 'events', /lista de eventos/);
    expectSingleIssue((data) => ((data as Record<string, unknown>).events = {}), 'events', /lista de eventos/);
  });

  it('cada evento debe ser un objeto, y los demás se siguen validando', () => {
    const issues = issuesAfter((data) => {
      data.events[0] = null as unknown as Record<string, unknown>;
      data.events[1].title = '';
    });
    expect(issues.map((issue) => issue.path)).toEqual(['events[0]', 'events[1].title']);
  });

  it('id, title y summary son obligatorios', () => {
    expectSingleIssue((data) => delete data.events[0].id, 'events[0].id', /obligatorio/);
    expectSingleIssue((data) => delete data.events[0].title, 'events[0].title', /obligatorio/);
    expectSingleIssue((data) => (data.events[0].summary = ''), 'events[0].summary', /obligatorio/);
  });

  it('ids de evento únicos y en kebab-case', () => {
    expectSingleIssue((data) => (data.events[3].id = 'a-school'), 'events[3].id', /id duplicado "a-school"/);
    expectSingleIssue((data) => (data.events[0].id = 'A School'), 'events[0].id', /kebab-case/);
  });

  it.each(['subtitle', 'description', 'location', 'organization'])('%s es opcional pero de texto', (key) => {
    expectSingleIssue((data) => (data.events[0][key] = 3), `events[0].${key}`, /debe ser un texto/);
  });

  it.each(['skills', 'highlights'])('%s: lista de textos no vacíos', (key) => {
    expectSingleIssue((data) => (data.events[0][key] = 'uno'), `events[0].${key}`, /lista de textos/);
    const issues = issuesAfter((data) => (data.events[0][key] = ['ok', '', 3, '  ']));
    expect(issues.map((issue) => issue.path)).toEqual([`events[0].${key}[1]`, `events[0].${key}[2]`, `events[0].${key}[3]`]);
    expect(issuesAfter((data) => (data.events[0][key] = []))).toEqual([]);
  });

  it('links: solo http(s)', () => {
    expectSingleIssue((data) => (data.events[0].links = {}), 'events[0].links', /lista de enlaces/);
    expectSingleIssue(
      (data) =>
        (data.events[0].links = [
          { label: 'ok', url: 'https://example.com' },
          { label: 'malo', url: 'javascript:alert(document.cookie)' },
        ]),
      'events[0].links[1].url',
      /"javascript:alert\(document\.cookie\)" debe ser una URL http\(s\) absoluta/,
    );
    for (const url of ['data:text/html,x', 'ftp://example.com', '/relativa', '//example.com', ' https://example.com']) {
      const issues = issuesAfter((data) => (data.events[0].links = [{ label: 'x', url }]));
      expect(issues.map((issue) => issue.path)).toEqual(['events[0].links[0].url']);
    }
  });

  it('importance: solo 1, 2 o 3', () => {
    for (const ok of [1, 2, 3]) expect(issuesAfter((data) => (data.events[0].importance = ok))).toEqual([]);
    for (const bad of [0, 4, 2.5, '2', null]) {
      expectSingleIssue((data) => (data.events[0].importance = bad), 'events[0].importance', /1, 2 o 3/);
    }
  });

  it('visibility: solo "public" o "private"', () => {
    expect(issuesAfter((data) => (data.events[0].visibility = 'public'))).toEqual([]);
    expectSingleIssue((data) => (data.events[0].visibility = 'secret'), 'events[0].visibility', /"public" o "private"/);
    expectSingleIssue((data) => (data.events[0].visibility = true), 'events[0].visibility', /"public" o "private"/);
  });

  it('branch: id en kebab-case', () => {
    expectSingleIssue((data) => (data.events[0].branch = 'Mi Rama'), 'events[0].branch', /kebab-case/);
    expectSingleIssue((data) => (data.events[0].branch = 5), 'events[0].branch', /kebab-case/);
  });
});

describe('LifeDataValidator: fechas', () => {
  it('date es obligatorio y debe ser un objeto', () => {
    expectSingleIssue((data) => delete data.events[0].date, 'events[0].date', /obligatorio/);
    expectSingleIssue((data) => (data.events[0].date = '2010'), 'events[0].date', /objeto/);
  });

  it.each([['2010-13'], ['2010-02-30'], ['10'], ['ayer'], [2010], [undefined], ['present']])(
    'date.start no válido (%j)',
    (start) => {
      expectSingleIssue((data) => (data.events[0].date = { start }), 'events[0].date.start', /no es una fecha válida/);
    },
  );

  it('date.end no válido', () => {
    expectSingleIssue(
      (data) => (data.events[0].date = { start: '2010', end: 'mañana' }),
      'events[0].date.end',
      /"mañana" no es una fecha válida.*"present"/,
    );
    expectSingleIssue((data) => (data.events[0].date = { start: '2010', end: 2014 }), 'events[0].date.end', /no es una fecha/);
    expectSingleIssue((data) => (data.events[0].date = { start: '2010', end: null }), 'events[0].date.end', /no es una fecha/);
  });

  it('end anterior a start es un error que nombra ambas fechas', () => {
    expectSingleIssue(
      (data) => (data.events[0].date = { start: '2014', end: '2010' }),
      'events[0].date.end',
      /"2010" es anterior a start "2014"/,
    );
    expectSingleIssue((data) => (data.events[0].date = { start: '2014-06', end: '2014-05' }), 'events[0].date.end', /anterior/);
    expectSingleIssue(
      (data) => (data.events[0].date = { start: '2014-06-10', end: '2014-06-09' }),
      'events[0].date.end',
      /anterior/,
    );
  });

  it.each([
    ['mismo año', '2014', '2014'],
    ['mismo día', '2014-06-10', '2014-06-10'],
    ['fin menos preciso que contiene al inicio', '2014-06', '2014'],
    ['inicio menos preciso que contiene al fin', '2014', '2014-03'],
    ['present', '2014', 'present'],
  ])('end >= start se acepta: %s', (_label, start, end) => {
    expect(issuesAfter((data) => (data.events[0].date = { start, end }))).toEqual([]);
  });

  it('con start y end inválidos se informan los dos', () => {
    const issues = issuesAfter((data) => (data.events[0].date = { start: 'x', end: 'y' }));
    expect(issues.map((issue) => issue.path)).toEqual(['events[0].date.start', 'events[0].date.end']);
  });
});

describe('LifeDataValidator: categorías de un evento', () => {
  it.each([[undefined], [[]], ['work']])('exige al menos una (%j)', (categories) => {
    expectSingleIssue((data) => (data.events[0].categories = categories), 'events[0].categories', /al menos un id/);
  });

  it('cada id debe ser texto y existir', () => {
    const issues = issuesAfter((data) => (data.events[0].categories = ['work', 7, 'fantasma']));
    expect(issues).toEqual([
      { path: 'events[0].categories[1]', message: 'debe ser un id de categoría' },
      { path: 'events[0].categories[2]', message: 'la categoría "fantasma" no existe' },
    ]);
  });
});

describe('LifeDataValidator: media', () => {
  const image = { type: 'image', url: 'https://example.com/a.png', alt: 'Una imagen' };

  it('acepta imágenes http(s) con alt (aunque esté vacío)', () => {
    expect(issuesAfter((data) => (data.events[0].media = [image, { ...image, alt: '' }]))).toEqual([]);
  });

  it('debe ser una lista de objetos', () => {
    expectSingleIssue((data) => (data.events[0].media = image), 'events[0].media', /lista/);
    expectSingleIssue((data) => (data.events[0].media = ['x']), 'events[0].media[0]', /objeto/);
  });

  it('solo type "image", url http(s) y alt obligatorio', () => {
    expectSingleIssue((data) => (data.events[0].media = [{ ...image, type: 'video' }]), 'events[0].media[0].type', /"image"/);
    expectSingleIssue(
      (data) => (data.events[0].media = [{ ...image, url: 'javascript:alert(1)' }]),
      'events[0].media[0].url',
      /http\(s\)/,
    );
    expectSingleIssue(
      (data) => (data.events[0].media = [{ type: 'image', url: image.url }]),
      'events[0].media[0].alt',
      /texto alternativo/,
    );
  });
});

describe('LifeDataValidator: ramas (branchFrom)', () => {
  it('branchFrom debe ser texto', () => {
    expectSingleIssue((data) => (data.events[2].branchFrom = 7), 'events[2].branchFrom', /id de un evento/);
  });

  it('el evento de origen debe existir', () => {
    expectSingleIssue((data) => (data.events[2].branchFrom = 'fantasma'), 'events[2].branchFrom', /"fantasma" no existe/);
  });

  it('un evento no puede bifurcarse de sí mismo', () => {
    expectSingleIssue((data) => (data.events[2].branchFrom = 'c-side'), 'events[2].branchFrom', /sí mismo/);
  });

  it('el tronco (main, explícito o por defecto) no admite branchFrom', () => {
    expectSingleIssue((data) => (data.events[1].branchFrom = 'a-school'), 'events[1].branchFrom', /tronco/);
    expectSingleIssue(
      (data) => {
        data.events[1].branch = 'main';
        data.events[1].branchFrom = 'a-school';
      },
      'events[1].branchFrom',
      /tronco/,
    );
  });

  it('el origen no puede pertenecer a la misma rama', () => {
    expectSingleIssue(
      (data) => (data.events[4].branchFrom = 'c-side'),
      'events[4].branchFrom',
      /misma rama "side"/,
    );
  });

  it('una rama solo puede nacer de un evento', () => {
    expectSingleIssue(
      (data) => (data.events[4].branchFrom = 'a-school'),
      'events[4].branchFrom',
      /la rama "side" ya nace de "b-job"/,
    );
  });

  it('repetir el mismo origen en varios eventos de la rama es válido', () => {
    expect(issuesAfter((data) => (data.events[4].branchFrom = 'b-job'))).toEqual([]);
  });

  it('una rama puede nacer de otra rama (anidadas) y de un evento privado', () => {
    expect(
      issuesAfter((data) => {
        data.events.push(makeEvent({ id: 'nested', branch: 'deep', branchFrom: 'c-side', date: { start: '2017' } }));
        data.events.push(makeEvent({ id: 'from-secret', branch: 'other', branchFrom: 'd-secret', date: { start: '2018' } }));
      }),
    ).toEqual([]);
  });

  it('una rama sin branchFrom es válida', () => {
    expect(issuesAfter((data) => data.events.push(makeEvent({ id: 'loose', branch: 'loose' })))).toEqual([]);
  });

  it('detecta ciclos de bifurcaciones entre ramas', () => {
    const issues = issuesAfter((data) => {
      data.events.push(makeEvent({ id: 'x1', branch: 'bx', branchFrom: 'y1' }), makeEvent({ id: 'y1', branch: 'by', branchFrom: 'x1' }));
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('events');
    expect(issues[0].message).toMatch(/ciclo de bifurcaciones \(bx → by → bx\)/);
  });

  it('detecta ciclos de tres ramas', () => {
    const issues = issuesAfter((data) => {
      data.events.push(
        makeEvent({ id: 'p1', branch: 'bp', branchFrom: 'r1' }),
        makeEvent({ id: 'q1', branch: 'bq', branchFrom: 'p1' }),
        makeEvent({ id: 'r1', branch: 'br', branchFrom: 'q1' }),
      );
    });
    expect(issues.map((issue) => issue.path)).toEqual(['events']);
    expect(issues[0].message).toContain('ciclo');
  });
});

describe('LifeDataValidator: acumulación de errores', () => {
  const broken = (): Loose => {
    const data = makeData() as unknown as Loose;
    data.schemaVersion = 3;
    data.meta.owner = '';
    data.categories[0].color = 'azul';
    data.categories[1].id = 'work';
    data.events[0].date = { start: '2014', end: '2010' };
    data.events[1].categories = ['no-existe'];
    data.events[2].branchFrom = 'fantasma';
    data.events[3].links = [{ label: 'x', url: 'javascript:alert(1)' }];
    data.events[4].importance = 9;
    return data;
  };

  it('devuelve TODOS los errores con su ruta, en orden de documento', () => {
    const result = validator.validate(broken());
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'schemaVersion',
      'meta.owner',
      'categories[0].color',
      'categories[1].id',
      'events[0].date.end',
      'events[0].categories[0]',
      'events[1].categories[0]',
      'events[3].links[0].url',
      'events[4].importance',
      'events[2].branchFrom',
    ]);
    for (const issue of result.issues) expect(issue.message.length).toBeGreaterThan(0);
  });

  it('nunca lanza, aunque el documento sea basura', () => {
    const garbage = { schemaVersion: 1, meta: 5, categories: [null, 3, []], events: [[], 'x', { date: [], categories: {} }] };
    expect(() => validator.validate(garbage)).not.toThrow();
    expect(validator.validate(garbage).issues.length).toBeGreaterThan(5);
  });

  it('assertValid lanza ValidationError con todos los errores y sus rutas en el mensaje', () => {
    let caught: unknown;
    try {
      validator.assertValid(broken());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const error = caught as ValidationError;
    expect(error.issues).toHaveLength(10);
    expect(error.message).toContain('(10 errores)');
    expect(error.message).toContain('events[0].date.end: "2010" es anterior a start "2014"');
    expect(error.message).toContain('events[2].branchFrom: el evento "fantasma" no existe');
  });
});
