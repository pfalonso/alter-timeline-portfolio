import type { TimelineViewModel } from '../../src/application/ports';
import { LifeEvent, Timeline, type Category, type LifeEventProps, type LifeMetaData } from '../../src/domain/model';

/** Crea un elemento y lo cuelga de <body> (hace falta para que `focus()` funcione en jsdom). */
export function mount<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

export function cleanupDom(): void {
  document.body.replaceChildren();
  document.title = '';
  document.documentElement.removeAttribute('lang');
}

/** Dispara un keydown que burbujea y se puede cancelar; devuelve el evento para inspeccionarlo. */
export function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

export function click(target: Element, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

export function texts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');
}

/**
 * Sustituye eventos y/o metadatos de un modelo SIN pasar por el validador ni la fábrica:
 * sirve para comprobar que la capa DOM se defiende sola de datos hostiles.
 */
export function unsafeModel(
  base: TimelineViewModel,
  changes: { meta?: Partial<LifeMetaData>; categories?: readonly Category[]; events?: Record<string, Partial<LifeEventProps>> },
): TimelineViewModel {
  const events = base.timeline.events.map((event) => new LifeEvent({ ...event, ...(changes.events?.[event.id] ?? {}) }));
  const timeline = new Timeline(
    { ...base.timeline.meta, ...changes.meta },
    changes.categories ?? base.timeline.categories,
    events,
    base.timeline.now,
    base.timeline.lines,
  );
  return { ...base, timeline };
}

/** [x, y] en píxeles del `translate3d(...)` de un elemento (jsdom normaliza el formato del número). */
export function translation(element: HTMLElement): [number, number] {
  const match = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)(?:px)?/.exec(element.style.transform);
  if (!match) throw new Error(`sin translate3d: "${element.style.transform}"`);
  return [Number(match[1]), Number(match[2])];
}
