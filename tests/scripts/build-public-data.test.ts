import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LifeData, LifeEventData } from '../../src/domain/model';
import { LifeDataValidator } from '../../src/domain/services/LifeDataValidator';
import { toPublicData } from '../../scripts/build-public-data';
import { makeData, makeEvent, makeLifeLinesData, makeStoryData } from '../helpers/fixtures';
import { makeUnionData } from '../helpers/unionFixtures';

type Raw = Parameters<typeof toPublicData>[0];
const asRaw = (data: LifeData): Raw => data as unknown as Raw;
const ids = (data: Raw): string[] => data.events.map((event) => event.id);
const eventOf = (data: Raw, id: string): Raw['events'][number] => {
  const found = data.events.find((event) => event.id === id);
  if (!found) throw new Error(`no hay evento ${id}`);
  return found;
};

/** Tronco a → b(privado) ; rama «lado» nace de b ; rama «hondo» nace de un evento privado de «lado». */
function chained(): LifeData {
  const data = makeData();
  const events: LifeEventData[] = [
    makeEvent({ id: 'a', date: { start: '2010' } }),
    makeEvent({ id: 'b', date: { start: '2012' }, visibility: 'private' }),
    makeEvent({ id: 'l-oculto', date: { start: '2013' }, branch: 'lado', branchFrom: 'b', visibility: 'private' }),
    makeEvent({ id: 'l-visible', date: { start: '2014' }, branch: 'lado', branchFrom: 'b' }),
    makeEvent({ id: 'h', date: { start: '2015' }, branch: 'hondo', branchFrom: 'l-oculto', categories: ['play'] }),
  ];
  return { ...data, events };
}

describe('toPublicData()', () => {
  it('quita del recorrido de la historia los pasos privados y conserva los arcos', () => {
    const data = makeStoryData();
    const output = toPublicData(asRaw(data));
    expect(output.story).toEqual({ title: 'La historia de Ada', path: ['a-school', 'b-job', 'c-side', 'e-side-two'] });
    expect(output.arcs).toEqual(data.arcs);
    expect(data.story?.path).toContain('d-secret');
    expect(new LifeDataValidator().validate(output).ok).toBe(true);
    expect('story' in toPublicData(asRaw(makeData()))).toBe(false);
  });

  it('quita los eventos privados y el campo visibility, sin tocar el original', () => {
    const data = makeData();
    const before = JSON.stringify(data);
    const output = toPublicData(asRaw(data));
    expect(ids(output)).not.toContain('d-secret');
    expect(output.events).toHaveLength(data.events.length - 1);
    expect(output.events.every((event) => !('visibility' in event))).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('conserva el resto de campos y el orden de los eventos', () => {
    const data = makeData();
    const output = toPublicData(asRaw(data));
    const job = data.events.find((event) => event.id === 'b-job');
    expect(eventOf(output, 'b-job')).toEqual(job);
    expect(ids(output)).toEqual(data.events.filter((event) => event.visibility !== 'private').map((event) => event.id));
  });

  it('una rama que nacía de un evento privado se reengancha a su ancestro público más cercano', () => {
    const output = toPublicData(asRaw(chained()));
    expect(ids(output)).toEqual(['a', 'l-visible', 'h']);
    // b es privado y está en el tronco, sin branchFrom: no hay ancestro público → nace del tronco.
    expect(eventOf(output, 'l-visible').branchFrom).toBeUndefined();
    // l-oculto es privado y nace de b (privado): tampoco hay ancestro público.
    expect(eventOf(output, 'h').branchFrom).toBeUndefined();
  });

  it('si el origen privado nace de un evento público, la rama pasa a nacer de ese', () => {
    const data = chained();
    data.events[1] = makeEvent({ id: 'b', date: { start: '2012' }, branch: 'medio', branchFrom: 'a', visibility: 'private' });
    const output = toPublicData(asRaw(data));
    expect(eventOf(output, 'l-visible').branchFrom).toBe('a');
  });

  it('un branchFrom a un evento inexistente o un ciclo entre privados no se cuelga y se descarta', () => {
    const data = chained();
    data.events[4] = makeEvent({ id: 'h', date: { start: '2015' }, branch: 'hondo', branchFrom: 'no-existe' });
    expect(eventOf(toPublicData(asRaw(data)), 'h').branchFrom).toBeUndefined();

    const cyclic = chained();
    cyclic.events[1] = makeEvent({ id: 'b', date: { start: '2012' }, branch: 'x', branchFrom: 'l-oculto', visibility: 'private' });
    expect(eventOf(toPublicData(asRaw(cyclic)), 'l-visible').branchFrom).toBeUndefined();
  });

  it('elimina las categorías que solo usaban eventos privados', () => {
    const data = makeData();
    data.categories.push({ id: 'solo-privada', label: 'Solo privada', color: '#123456' });
    const secret = data.events.find((event) => event.id === 'd-secret');
    if (secret) secret.categories = ['solo-privada'];
    const output = toPublicData(asRaw(data));
    expect(output.categories.map((category) => category.id)).not.toContain('solo-privada');
    expect(output.categories.map((category) => category.id)).toContain('play');
  });

  it('el resultado de los datos de ejemplo sigue validando', () => {
    const example = JSON.parse(readFileSync('public/data/life.example.json', 'utf8')) as Raw;
    const output = toPublicData(example);
    expect(new LifeDataValidator().validate(output).ok).toBe(true);
    expect(output.events.length).toBeLessThan(example.events.length);
  });
});

describe('toPublicData con líneas vitales', () => {
  const validator = new LifeDataValidator();
  const hide = (data: LifeData, ...hidden: string[]): LifeData => {
    for (const event of data.events) if (hidden.includes(event.id)) event.visibility = 'private';
    return data;
  };

  it('sin privados que afecten a las líneas, las conserva tal cual', () => {
    const data = makeLifeLinesData();
    expect(toPublicData(asRaw(data)).branches).toEqual(data.branches);
  });

  it('quita las líneas sin eventos públicos, el origin privado y la fusión en un evento privado', () => {
    const data = hide(makeLifeLinesData(), 'bread', 'birth', 'master');
    const output = toPublicData(asRaw(data));
    const lines = output.branches ?? [];
    expect(lines.map((line) => line.id)).toEqual(['core', 'art', 'teach']);
    expect(lines.find((line) => line.id === 'art')?.mergeInto).toBeUndefined();
    expect(lines.find((line) => line.id === 'art')?.origin).toBeUndefined();
    expect(validator.validate(output).issues).toEqual([]);
  });

  it('reengancha un origin privado a su ancestro público si existe (y no si cae en la propia línea)', () => {
    const data = makeLifeLinesData((d) => {
      d.events.push(makeEvent({ id: 'secret', date: { start: '2008' }, branch: 'teach', branchFrom: 'degree', visibility: 'private' }));
      d.events.push(makeEvent({ id: 'own', date: { start: '2009' }, branch: 'food', branchFrom: 'degree', visibility: 'private' }));
      (d.branches ?? [])[3].origin = 'secret';
      (d.branches ?? [])[2].origin = 'own';
    });
    const output = toPublicData(asRaw(data));
    expect(output.branches?.find((line) => line.id === 'teach')?.origin).toBe('degree');
    expect(validator.validate(output).issues).toEqual([]);
    const selfAnchored = makeLifeLinesData((d) => {
      d.events.push(makeEvent({ id: 'self', date: { start: '2008' }, branch: 'teach', branchFrom: 'bread', visibility: 'private' }));
      (d.branches ?? [])[2].origin = 'self';
    });
    expect(validator.validate(selfAnchored).issues).toEqual([]);
    expect(toPublicData(asRaw(selfAnchored)).branches?.find((line) => line.id === 'food')?.origin).toBeUndefined();
  });
});

const dir = mkdtempSync(join(tmpdir(), 'build-public-data-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/build-public-data.ts', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('scripts/build-public-data.ts', () => {
  it('sale con 0 y escribe el fichero público (creando la carpeta) sin privados', () => {
    const target = join(dir, 'sub', 'life.json');
    const result = run('public/data/life.example.json', target);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/26 eventos públicos \(1 privados eliminados\)/);
    const written = JSON.parse(readFileSync(target, 'utf8')) as Raw;
    expect(written.events.some((event) => event.visibility === 'private')).toBe(false);
  }, 90_000);

  it('sale con 1 y no escribe nada si el origen no valida', () => {
    const source = join(dir, 'roto.json');
    const target = join(dir, 'no-debe-existir.json');
    const broken = makeData();
    broken.categories[0].color = 'azul';
    writeFileSync(source, JSON.stringify(broken));
    const result = run(source, target);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('categories[0].color');
    expect(existsSync(target)).toBe(false);
  }, 90_000);

  it('sale con 2 si el origen no existe o no es JSON', () => {
    expect(run(join(dir, 'no-existe.json'), join(dir, 'x.json')).status).toBe(2);
    const notJson = join(dir, 'malo.json');
    writeFileSync(notJson, '{ "schemaVersion": ');
    expect(run(notJson, join(dir, 'y.json')).status).toBe(2);
  }, 90_000);
});

describe('toPublicData con enlaces causales', () => {
  it('quita los destinos privados de ledTo y la lista si se queda vacía', () => {
    const data = makeData();
    data.events[0].ledTo = ['b-job', 'd-secret'];
    data.events[1].ledTo = ['d-secret'];
    const result = toPublicData(asRaw(data));
    expect(eventOf(result, 'a-school').ledTo).toEqual(['b-job']);
    expect('ledTo' in eventOf(result, 'b-job')).toBe(false);
    expect(new LifeDataValidator().validate(result).ok).toBe(true);
    expect(data.events[1].ledTo).toEqual(['d-secret']);
  });
});

describe('toPublicData con nodos de unión, caminos que no fueron y pausas', () => {
  const validator = new LifeDataValidator();
  const base = (): Raw => asRaw(makeUnionData());
  const privatize = (data: Raw, ...privateIds: string[]): Raw => {
    for (const id of privateIds) eventOf(data, id).visibility = 'private';
    return data;
  };

  it('sin privados, conserva alsoBranches, active, ghost y pauses', () => {
    const out = toPublicData(base());
    expect(eventOf(out, 'e-accident').alsoBranches).toEqual(['tech', 'arte', 'cocina']);
    expect(eventOf(out, 'e-tech2').active).toBe(true);
    expect(out.branches?.filter((line) => line.ghost).map((line) => line.id)).toEqual(['derecho', 'arquitectura']);
    expect(validator.validate(out).issues).toEqual([]);
  });

  it('una pausa con un extremo privado se quita y el resultado valida', () => {
    const out = toPublicData(privatize(base(), 'e-recovery'));
    expect(out.branches?.find((line) => line.id === 'tech')?.pauses).toBeUndefined();
    expect(validator.validate(out).issues).toEqual([]);
  });

  it('un camino que no fue con origen privado se reengancha o desaparece; la línea nacida allí también', () => {
    const data = privatize(base(), 'e-cross');
    const out = toPublicData(data);
    expect(out.branches?.some((line) => line.ghost)).toBe(false);
    expect(validator.validate(out).issues).toEqual([]);
  });

  it('quita de alsoBranches las líneas que ya no existen o ya no están vivas', () => {
    const data = privatize(base(), 'e-cook1', 'e-cook2');
    const out = toPublicData(data);
    // cocina solo sigue por los nodos de unión públicos.
    expect(eventOf(out, 'e-accident').alsoBranches).toContain('cocina');
    const ended = base();
    eventOf(ended, 'e-art2').visibility = 'private';
    eventOf(ended, 'e-cook2').alsoBranches = ['arte'];
    eventOf(ended, 'e-cook2').date = { start: '2019' };
    eventOf(ended, 'e-art2').date = { start: '2018', end: '2019' };
    const cleaned = toPublicData(ended);
    expect(eventOf(cleaned, 'e-cook2').alsoBranches).toBeUndefined();
    expect(validator.validate(cleaned).issues).toEqual([]);
  });
});
