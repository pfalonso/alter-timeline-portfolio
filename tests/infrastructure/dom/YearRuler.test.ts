import { afterEach, describe, expect, it } from 'vitest';
import { YearRuler } from '../../../src/infrastructure/dom/YearRuler';
import type { ProjectedFrame, ProjectedYear } from '../../../src/infrastructure/three/types';
import { cleanupDom, mount, texts, translation } from '../../helpers/dom';
import { buildModel } from '../../helpers/fixtures';

afterEach(cleanupDom);

const VIEWPORT = { width: 1000, height: 600 };

function frame(years: ProjectedYear[], nowX: number | null = null): ProjectedFrame {
  return { nodes: [], years, nowX, cameraDistance: 40, viewport: VIEWPORT };
}

function setup(): { root: HTMLElement; ruler: YearRuler; tick: (year: number) => HTMLElement } {
  const root = mount('div');
  const ruler = new YearRuler(root);
  ruler.render(buildModel());
  const tick = (year: number): HTMLElement => {
    const node = [...root.querySelectorAll<HTMLElement>('.ruler__tick')].find((item) => item.textContent === String(year));
    if (!node) throw new Error(`no hay marca ${year}`);
    return node;
  };
  return { root, ruler, tick };
}

describe('YearRuler', () => {
  it('es decorativa (aria-hidden) y pinta una marca por año del layout más "hoy"', () => {
    const { root } = setup();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(texts(root, '.ruler__tick')).toEqual(['2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020']);
    expect(root.lastElementChild?.className).toBe('ruler__now');
    expect(root.lastElementChild?.textContent).toBe('hoy');
  });

  it('volver a pintar no duplica marcas', () => {
    const { root, ruler } = setup();
    ruler.render(buildModel());
    expect(root.querySelectorAll('.ruler__tick')).toHaveLength(12);
    expect(root.querySelectorAll('.ruler__now')).toHaveLength(1);
  });

  it('coloca cada marca en su X proyectada y oculta las que quedan fuera o detrás de la cámara', () => {
    const { ruler, tick } = setup();
    ruler.onProjected(
      frame([
        { year: 2010, x: 10, inFront: true }, // demasiado pegada al borde izquierdo
        { year: 2011, x: 200.26, inFront: true },
        { year: 2012, x: 400, inFront: false }, // detrás de la cámara
        { year: 2013, x: 990, inFront: true }, // demasiado pegada al borde derecho
        { year: 2014, x: 976, inFront: true },
        { year: 1999, x: 500, inFront: true }, // sin marca: se ignora
      ]),
    );
    expect(tick(2010).hidden).toBe(true);
    expect(tick(2012).hidden).toBe(true);
    expect(tick(2013).hidden).toBe(true);
    expect(tick(2011).hidden).toBe(false);
    expect(tick(2014).hidden).toBe(false);
    expect(translation(tick(2011))).toEqual([200.3, 0]);
    expect(translation(tick(2014))).toEqual([976, 0]);
  });

  it('con poco espacio entre años solo destacan los múltiplos del paso', () => {
    const { ruler, tick } = setup();
    // 30 px por año → paso de 2 años.
    const years = [2010, 2011, 2012, 2013, 2014].map((year, index) => ({ year, x: 100 + index * 30, inFront: true }));
    ruler.onProjected(frame(years));
    expect([2010, 2011, 2012, 2013, 2014].map((year) => tick(year).classList.contains('ruler__tick--minor'))).toEqual([
      false, true, false, true, false,
    ]);
    // 120 px por año → todas son principales.
    ruler.onProjected(frame(years.map((mark, index) => ({ ...mark, x: 100 + index * 120 }))));
    expect([2010, 2011, 2012].map((year) => tick(year).classList.contains('ruler__tick--minor'))).toEqual([false, false, false]);
  });

  it('con una sola marca visible asume espacio suficiente', () => {
    const { ruler, tick } = setup();
    ruler.onProjected(frame([{ year: 2011, x: 300, inFront: true }]));
    expect(tick(2011).hidden).toBe(false);
    expect(tick(2011).classList.contains('ruler__tick--minor')).toBe(false);
  });

  it('la marca de "hoy" se muestra solo si está en pantalla', () => {
    const { root, ruler } = setup();
    const now = root.querySelector<HTMLElement>('.ruler__now');
    if (!now) throw new Error('falta hoy');
    ruler.onProjected(frame([], 512.34));
    expect(now.hidden).toBe(false);
    expect(translation(now)).toEqual([512.3, 0]);
    ruler.onProjected(frame([], null));
    expect(now.hidden).toBe(true);
    ruler.onProjected(frame([], 5));
    expect(now.hidden).toBe(true);
    ruler.onProjected(frame([], 995));
    expect(now.hidden).toBe(true);
  });
});
