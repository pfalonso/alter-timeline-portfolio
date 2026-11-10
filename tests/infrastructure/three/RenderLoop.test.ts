import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserScheduler, documentVisibility, RenderLoop, type Tick } from '../../../src/infrastructure/three/RenderLoop';
import { ManualScheduler, ManualVisibility } from '../../helpers/three';

function setup(maxDelta?: number): { loop: RenderLoop; scheduler: ManualScheduler; visibility: ManualVisibility; tick: ReturnType<typeof vi.fn<Tick>> } {
  const scheduler = new ManualScheduler();
  const visibility = new ManualVisibility();
  const loop = maxDelta === undefined ? new RenderLoop(scheduler, visibility) : new RenderLoop(scheduler, visibility, maxDelta);
  return { loop, scheduler, visibility, tick: vi.fn<Tick>() };
}

describe('RenderLoop', () => {
  it('no pide fotogramas hasta que se arranca', () => {
    const { loop, scheduler } = setup();
    expect(loop.running).toBe(false);
    expect(scheduler.pending.size).toBe(0);
  });

  it('llama al tick en cada fotograma con el delta en segundos y el tiempo acumulado', () => {
    const { loop, scheduler, tick } = setup();
    loop.start(tick);
    expect(loop.running).toBe(true);
    scheduler.tick(1000);
    scheduler.tick(1016);
    scheduler.tick(1066);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(tick.mock.calls[0]).toEqual([0, 0]);
    expect(tick.mock.calls[1][0]).toBeCloseTo(0.016, 10);
    expect(tick.mock.calls[2][0]).toBeCloseTo(0.05, 10);
    expect(tick.mock.calls[2][1]).toBeCloseTo(0.066, 10);
    expect(scheduler.pending.size).toBe(1);
  });

  it('acota el delta (pestaña dormida, depurador…) y nunca es negativo', () => {
    const { loop, scheduler, tick } = setup();
    loop.start(tick);
    scheduler.tick(0);
    scheduler.tick(5000);
    scheduler.tick(4000);
    expect(tick.mock.calls.map((call) => call[0])).toEqual([0, 0.1, 0]);
    expect(tick.mock.calls[2][1]).toBeCloseTo(0.1, 10);
  });

  it('el delta máximo es configurable', () => {
    const { loop, scheduler, tick } = setup(0.5);
    loop.start(tick);
    scheduler.tick(0);
    scheduler.tick(5000);
    expect(tick.mock.calls[1][0]).toBe(0.5);
  });

  it('stop cancela el fotograma pendiente', () => {
    const { loop, scheduler, tick } = setup();
    loop.start(tick);
    const [handle] = [...scheduler.pending.keys()];
    loop.stop();
    expect(loop.running).toBe(false);
    expect(scheduler.cancelled).toEqual([handle]);
    expect(scheduler.tick(16)).toBe(0);
    expect(tick).not.toHaveBeenCalled();
    loop.stop();
    expect(scheduler.cancelled).toHaveLength(1);
  });

  it('un fotograma que llega tras parar se ignora', () => {
    const { loop, scheduler, tick } = setup();
    loop.start(tick);
    const [late] = [...scheduler.pending.values()];
    loop.stop();
    late(16);
    expect(tick).not.toHaveBeenCalled();
    expect(scheduler.pending.size).toBe(0);
  });

  it('arrancar dos veces no duplica el bucle; el segundo tick sustituye al primero', () => {
    const { loop, scheduler, tick } = setup();
    const second = vi.fn<Tick>();
    loop.start(tick);
    loop.start(second);
    expect(scheduler.pending.size).toBe(1);
    scheduler.tick(0);
    expect(tick).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('se pausa con la pestaña oculta y al volver no acumula el tiempo dormido', () => {
    const { loop, scheduler, visibility, tick } = setup();
    loop.start(tick);
    scheduler.tick(0);
    scheduler.tick(100);
    visibility.set(true);
    expect(loop.running).toBe(false);
    expect(scheduler.pending.size).toBe(0);

    visibility.set(false);
    expect(loop.running).toBe(true);
    scheduler.tick(60_000);
    expect(tick).toHaveBeenLastCalledWith(0, expect.closeTo(0.1, 10));
    scheduler.tick(60_020);
    expect(tick.mock.calls.at(-1)?.[0]).toBeCloseTo(0.02, 10);
  });

  it('si se arranca con la pestaña oculta, espera a que sea visible', () => {
    const { loop, scheduler, visibility, tick } = setup();
    visibility.hidden = true;
    loop.start(tick);
    expect(loop.running).toBe(false);
    visibility.set(false);
    expect(scheduler.tick(0)).toBe(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('volver a ser visible no reanuda un bucle parado', () => {
    const { loop, scheduler, visibility, tick } = setup();
    loop.start(tick);
    loop.stop();
    visibility.set(true);
    visibility.set(false);
    expect(loop.running).toBe(false);
    expect(scheduler.pending.size).toBe(0);
  });
});

describe('RenderLoop: adaptadores del navegador', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('browserScheduler delega en requestAnimationFrame / cancelAnimationFrame', () => {
    const raf = vi.fn(() => 42);
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    const callback = (): void => undefined;
    expect(browserScheduler.request(callback)).toBe(42);
    expect(raf).toHaveBeenCalledWith(callback);
    browserScheduler.cancel(42);
    expect(caf).toHaveBeenCalledWith(42);
  });

  it('documentVisibility lee document.hidden y escucha visibilitychange', () => {
    expect(documentVisibility.isHidden()).toBe(document.hidden);
    const listener = vi.fn();
    documentVisibility.onChange(listener);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('por defecto usa los adaptadores del navegador', () => {
    const raf = vi.fn(() => 7);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const loop = new RenderLoop();
    loop.start(() => undefined);
    expect(raf).toHaveBeenCalledTimes(1);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
