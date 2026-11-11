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
  it('es decorativa (aria-hidden) y pinta una marca por cambio de año del layout más "hoy"', () => {
    const { root } = setup();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(texts(root, '.ruler__tick')).toEqual(['2010', '2015', '2016', '2018']);
    expect(root.lastElementChild?.className).toBe('ruler__now');
    expect(root.lastElementChild?.textContent).toBe('hoy');
  });

  it('volver a pintar (o filtrar) no duplica marcas', () => {
    const { root, ruler } = setup();
    ruler.render(buildModel());
    expect(root.querySelectorAll('.ruler__tick')).toHaveLength(4);
    const model = buildModel();
    ruler.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0, layout: { ...model.layout, years: [{ year: 2015, x: 0 }] } });
    expect(texts(root, '.ruler__tick')).toEqual(['2015']);
    expect(root.querySelectorAll('.ruler__now')).toHaveLength(1);
    ruler.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0 });
    expect(texts(root, '.ruler__tick')).toEqual(['2015']);
  });

  it('coloca cada marca en su X proyectada y oculta las que quedan fuera o detrás de la cámara', () => {
    const { ruler, tick } = setup();
    ruler.onProjected(
      frame([
        { year: 2010, x: 10, inFront: true }, // demasiado pegada al borde izquierdo
        { year: 2015, x: 200.26, inFront: true },
        { year: 2016, x: 400, inFront: false }, // detrás de la cámara
        { year: 2018, x: 976, inFront: true },
        { year: 1999, x: 500, inFront: true }, // sin marca: se ignora
      ]),
    );
    expect(tick(2010).hidden).toBe(true);
    expect(tick(2016).hidden).toBe(true);
    expect(tick(2015).hidden).toBe(false);
    expect(tick(2018).hidden).toBe(false);
    expect(translation(tick(2015))).toEqual([200.3, 0]);
    expect(translation(tick(2018))).toEqual([976, 0]);
  });

  it('si no caben, se rotulan antes décadas, lustros y pares; nunca dos solapadas', () => {
    const { ruler, tick } = setup();
    ruler.onProjected(
      frame([
        { year: 2010, x: 100, inFront: true },
        { year: 2015, x: 130, inFront: true },
        { year: 2016, x: 160, inFront: true },
        { year: 2018, x: 300, inFront: true },
      ]),
    );
    expect([2010, 2015, 2016, 2018].map((year) => tick(year).hidden)).toEqual([false, true, false, false]);
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
