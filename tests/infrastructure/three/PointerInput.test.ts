import { afterEach, describe, expect, it, vi } from 'vitest';
import { PointerInput, type PointerInputHandlers } from '../../../src/infrastructure/three/PointerInput';
import { cleanupDom, mount } from '../../helpers/dom';

afterEach(cleanupDom);

type Fakes = { [K in keyof PointerInputHandlers]: ReturnType<typeof vi.fn<PointerInputHandlers[K]>> };

function setup(): { element: HTMLElement; input: PointerInput; handlers: Fakes } {
  const element = mount('canvas');
  element.getBoundingClientRect = (): DOMRect => new DOMRect(100, 50, 800, 600);
  const handlers: Fakes = {
    onDrag: vi.fn<PointerInputHandlers['onDrag']>(),
    onScroll: vi.fn<PointerInputHandlers['onScroll']>(),
    onZoom: vi.fn<PointerInputHandlers['onZoom']>(),
    onHover: vi.fn<PointerInputHandlers['onHover']>(),
    onTap: vi.fn<PointerInputHandlers['onTap']>(),
  };
  return { element, input: new PointerInput(element, handlers), handlers };
}

function pointer(element: HTMLElement, type: string, x: number, y: number, init: PointerEventInit = {}): void {
  element.dispatchEvent(
    new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, ...init }),
  );
}

function wheel(element: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

describe('PointerInput: hover y toque', () => {
  it('mover el ratón sin pulsar informa de la posición relativa al elemento', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointermove', 150, 80);
    expect(handlers.onHover).toHaveBeenCalledExactlyOnceWith({ x: 50, y: 30 });
  });

  it('salir del elemento anula el hover', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerleave', 0, 0);
    expect(handlers.onHover).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('un dedo que se mueve sin haber tocado antes no genera hover', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointermove', 150, 80, { pointerType: 'touch' });
    expect(handlers.onHover).not.toHaveBeenCalled();
  });

  it('pulsar y soltar sin moverse es un toque, en coordenadas locales', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointerup', 300, 200);
    expect(handlers.onTap).toHaveBeenCalledExactlyOnceWith({ x: 200, y: 150 });
    expect(handlers.onDrag).not.toHaveBeenCalled();
  });

  it('un temblor de pocos píxeles sigue siendo un toque', () => {
    const { element, input, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointermove', 303, 202);
    expect(input.dragging).toBe(false);
    pointer(element, 'pointerup', 303, 202);
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onDrag).not.toHaveBeenCalled();
  });

  it('solo cuenta el botón principal del ratón', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200, { button: 2 });
    pointer(element, 'pointerup', 300, 200, { button: 2 });
    pointer(element, 'pointerdown', 300, 200, { button: 1 });
    pointer(element, 'pointerup', 300, 200, { button: 1 });
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it('un pointerup huérfano (sin pointerdown) se ignora', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerup', 300, 200);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it('captura el puntero al pulsar y lo libera al soltar (si el navegador lo soporta)', () => {
    const { element } = setup();
    const capture = vi.fn();
    const release = vi.fn();
    element.setPointerCapture = capture;
    element.releasePointerCapture = release;
    pointer(element, 'pointerdown', 300, 200, { pointerId: 9 });
    pointer(element, 'pointerup', 300, 200, { pointerId: 9 });
    expect(capture).toHaveBeenCalledExactlyOnceWith(9);
    expect(release).toHaveBeenCalledExactlyOnceWith(9);
  });
});

describe('PointerInput: arrastre', () => {
  it('superado el umbral, cada movimiento es un arrastre incremental y se anula el hover', () => {
    const { element, input, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointermove', 310, 200);
    pointer(element, 'pointermove', 325, 190);
    expect(input.dragging).toBe(true);
    expect(handlers.onDrag.mock.calls).toEqual([
      [10, 0],
      [15, -10],
    ]);
    expect(handlers.onHover).toHaveBeenCalledWith(null);
    pointer(element, 'pointerup', 325, 190);
    expect(handlers.onTap).not.toHaveBeenCalled();
    expect(input.dragging).toBe(false);
  });

  it('tras un arrastre, el siguiente gesto puede volver a ser un toque', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointermove', 400, 200);
    pointer(element, 'pointerup', 400, 200);
    pointer(element, 'pointerdown', 400, 200);
    pointer(element, 'pointerup', 400, 200);
    expect(handlers.onTap).toHaveBeenCalledExactlyOnceWith({ x: 300, y: 150 });
  });

  it('pointercancel aborta el gesto sin generar toque', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointercancel', 300, 200);
    pointer(element, 'pointerup', 300, 200);
    expect(handlers.onTap).not.toHaveBeenCalled();
    // Y el puntero vuelve a comportarse como hover.
    pointer(element, 'pointermove', 310, 210);
    expect(handlers.onHover).toHaveBeenLastCalledWith({ x: 210, y: 160 });
  });
});

describe('PointerInput: pellizco', () => {
  const touch = (id: number): PointerEventInit => ({ pointerId: id, pointerType: 'touch' });

  it('separar dos dedos acerca (factor < 1); juntarlos aleja (factor > 1)', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 300, touch(1));
    pointer(element, 'pointerdown', 400, 300, touch(2));
    pointer(element, 'pointermove', 500, 300, touch(2)); // 100 → 200 px
    expect(handlers.onZoom).toHaveBeenLastCalledWith(0.5);
    pointer(element, 'pointermove', 350, 300, touch(2)); // 200 → 50 px
    expect(handlers.onZoom).toHaveBeenLastCalledWith(4);
    expect(handlers.onDrag).not.toHaveBeenCalled();
  });

  it('un pellizco nunca acaba en toque, y al quedar un dedo se puede seguir arrastrando', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 300, touch(1));
    pointer(element, 'pointerdown', 400, 300, touch(2));
    pointer(element, 'pointerup', 400, 300, touch(2));
    pointer(element, 'pointermove', 310, 300, touch(1));
    expect(handlers.onDrag).toHaveBeenCalledExactlyOnceWith(10, 0);
    pointer(element, 'pointerup', 310, 300, touch(1));
    expect(handlers.onTap).not.toHaveBeenCalled();
    expect(handlers.onZoom).not.toHaveBeenCalled();
  });

  it('dos dedos en el mismo punto no producen un zoom infinito', () => {
    const { element, handlers } = setup();
    pointer(element, 'pointerdown', 300, 300, touch(1));
    pointer(element, 'pointerdown', 300, 300, touch(2));
    pointer(element, 'pointermove', 340, 300, touch(2));
    expect(handlers.onZoom).not.toHaveBeenCalled();
    pointer(element, 'pointermove', 380, 300, touch(2));
    expect(handlers.onZoom).toHaveBeenCalledExactlyOnceWith(0.5);
  });
});

describe('PointerInput: rueda', () => {
  it('la rueda desplaza (viajar en el tiempo) y anula el scroll de la página', () => {
    const { element, handlers } = setup();
    const event = wheel(element, { deltaX: 3, deltaY: 40 });
    expect(handlers.onScroll).toHaveBeenCalledExactlyOnceWith(3, 40);
    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onZoom).not.toHaveBeenCalled();
  });

  it('normaliza las unidades: líneas ×32, páginas ×600', () => {
    const { element, handlers } = setup();
    wheel(element, { deltaY: 3, deltaMode: 1 });
    wheel(element, { deltaY: 1, deltaMode: 2 });
    expect(handlers.onScroll.mock.calls).toEqual([
      [0, 96],
      [0, 600],
    ]);
  });

  it('Ctrl/⌘ + rueda hace zoom: hacia abajo aleja, hacia arriba acerca, de forma simétrica', () => {
    const { element, handlers } = setup();
    wheel(element, { deltaY: 10, ctrlKey: true });
    wheel(element, { deltaY: -10, metaKey: true });
    const [out, into] = handlers.onZoom.mock.calls.map((call) => call[0]);
    expect(out).toBeCloseTo(Math.exp(0.12), 10);
    expect(into).toBeCloseTo(Math.exp(-0.12), 10);
    expect(out * into).toBeCloseTo(1, 10);
    expect(handlers.onScroll).not.toHaveBeenCalled();
  });

  it('acota los saltos de zoom de ruedas muy bruscas', () => {
    const { element, handlers } = setup();
    wheel(element, { deltaY: 100000, ctrlKey: true });
    wheel(element, { deltaY: -100000, ctrlKey: true });
    expect(handlers.onZoom.mock.calls[0][0]).toBeCloseTo(Math.exp(0.72), 10);
    expect(handlers.onZoom.mock.calls[1][0]).toBeCloseTo(Math.exp(-0.72), 10);
  });
});

describe('PointerInput: dispose', () => {
  it('deja de escuchar todos los eventos', () => {
    const { element, input, handlers } = setup();
    input.dispose();
    pointer(element, 'pointermove', 150, 80);
    pointer(element, 'pointerdown', 300, 200);
    pointer(element, 'pointerup', 300, 200);
    pointer(element, 'pointerleave', 0, 0);
    const event = wheel(element, { deltaY: 10 });
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
