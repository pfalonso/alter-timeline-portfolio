import { afterEach, describe, expect, it } from 'vitest';
import { NEUTRAL_CHIP } from '../../../src/infrastructure/dom/dom';
import { EventPopup } from '../../../src/infrastructure/dom/EventPopup';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, click, mount, press, texts } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeData, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

interface Setup {
  readonly root: HTMLElement;
  readonly popup: EventPopup;
  readonly handlers: ReturnType<typeof fakeHandlers>;
}

function setup(data = makeData(), includePrivate = false): Setup {
  const root = mount('aside');
  const popup = new EventPopup(root);
  const handlers = fakeHandlers();
  popup.bind(handlers);
  popup.render(buildModel(data, { includePrivate }));
  return { root, popup, handlers };
}

const button = (root: HTMLElement, selector: string, index = 0): HTMLButtonElement => {
  const node = root.querySelectorAll<HTMLButtonElement>(selector)[index];
  if (!node) throw new Error(`no hay ${selector}[${index}]`);
  return node;
};
const closeButton = (root: HTMLElement): HTMLButtonElement => button(root, '.popup__close');
const prevButton = (root: HTMLElement): HTMLButtonElement => button(root, '.popup__nav', 0);
const nextButton = (root: HTMLElement): HTMLButtonElement => button(root, '.popup__nav', 1);
const pointerDown = (target: EventTarget): void => {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
};

describe('EventPopup: accesibilidad del diálogo', () => {
  it('es un diálogo NO modal etiquetado por su título y empieza oculto', () => {
    const { root, popup } = setup();
    expect(root.getAttribute('role')).toBe('dialog');
    // Panel lateral sin velo: el resto de la página sigue operable, así que no declara aria-modal.
    expect(root.hasAttribute('aria-modal')).toBe(false);
    expect(root.getAttribute('aria-labelledby')).toBe('popup-title');
    expect(root.tabIndex).toBe(-1);
    expect(root.hidden).toBe(true);
    expect(popup.isOpen).toBe(false);
  });

  it('el botón de cerrar tiene nombre accesible y los botones no envían formularios', () => {
    const { root } = setup();
    expect(closeButton(root).getAttribute('aria-label')).toBe(STRINGS.close);
    for (const node of root.querySelectorAll('button')) expect(node.type).toBe('button');
    expect(prevButton(root).textContent).toContain(STRINGS.previous);
    expect(nextButton(root).textContent).toContain(STRINGS.next);
  });

  it('al abrirse se muestra, el título lleva el id que referencia aria-labelledby y recibe el foco', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    expect(root.hidden).toBe(false);
    expect(popup.isOpen).toBe(true);
    const title = root.querySelector('#popup-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Primer trabajo');
    expect(document.activeElement).toBe(root);
    expect(root.classList.contains('popup--enter')).toBe(true);
  });

  it('solo se abre con detailOpen; enfocar un evento (sin abrir) no lo muestra', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', false));
    expect(root.hidden).toBe(true);
    popup.applySelection(selection(null, true));
    expect(root.hidden).toBe(true);
    popup.applySelection(selection('no-existe', true));
    expect(root.hidden).toBe(true);
  });

  it('no se abre si aún no se ha pintado ningún modelo', () => {
    const root = mount('aside');
    const popup = new EventPopup(root);
    popup.applySelection(selection('b-job', true));
    expect(root.hidden).toBe(true);
  });
});

describe('EventPopup: contenido', () => {
  it('muestra todo el detalle del evento', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));

    expect(texts(root, '.popup__categories .tag')).toEqual(['▲ Trabajo', 'Estudios']);
    expect(root.querySelector('.popup__subtitle')?.textContent).toBe('Ingeniera · Acme');
    expect(root.querySelector('.popup__summary')?.textContent).toBe('Un trabajo que sigue.');
    expect(texts(root, '.popup__paragraph')).toEqual(['Primer párrafo.', 'Segundo párrafo.']);
    expect(texts(root, '.popup__highlights li')).toEqual(['Un hito']);
    expect(texts(root, '.popup__skills li')).toEqual(['TypeScript', 'three.js']);
    expect(texts(root, '.popup__section h3')).toEqual([STRINGS.highlights, STRINGS.skills, STRINGS.links]);

    const facts = [...root.querySelectorAll('.popup__facts > div')].map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ]);
    expect(facts[0][0]).toBe('Cuándo');
    expect(facts[0][1]).toMatch(/^mar\.? 2015 — actualidad$/);
    expect(facts.slice(1)).toEqual([
      ['Dónde', 'Donostia'],
      ['Con', 'Acme'],
    ]);
    expect(texts(root, '.popup__badges .badge')).toEqual([STRINGS.ongoing]);
    // El acento es el color de la línea del evento (main: el de su primer evento); las categorías, neutras.
    expect(root.style.getPropertyValue('--accent')).toBe('#6EA8FF');
    expect(root.querySelector<HTMLElement>('.tag')?.style.getPropertyValue('--chip-color')).toBe(NEUTRAL_CHIP);
  });

  it('los enlaces se abren en otra pestaña con rel="noopener noreferrer"', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.popup__links a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/acme');
    expect(links[0].target).toBe('_blank');
    expect(links[0].relList.contains('noopener')).toBe(true);
    expect(links[0].relList.contains('noreferrer')).toBe(true);
    expect(links[0].textContent).toBe('Acme ↗');
  });

  it('un evento mínimo no deja secciones vacías', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('a-school', true));
    expect(root.querySelector('.popup__subtitle')).toBeNull();
    expect(root.querySelector('.popup__section')).toBeNull();
    expect(root.querySelector('.popup__media')).toBeNull();
    expect(root.querySelector('.popup__paragraph')).toBeNull();
    expect(root.querySelectorAll('.popup__facts > div')).toHaveLength(1);
    expect(root.querySelector('.popup__facts dd')?.textContent).toBe('2010 — 2014');
    expect(root.querySelector('.popup__badges')?.childElementCount).toBe(0);
  });

  it('indica de qué evento nace una rama', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('c-side', true));
    expect(texts(root, '.badge--branch')).toEqual(['Rama que nace de «Primer trabajo»']);
  });

  it('marca los eventos privados (visibles solo con ?private=1)', () => {
    const { root, popup } = setup(makeData(), true);
    popup.applySelection(selection('d-secret', true));
    expect(texts(root, '.popup__badges .badge')).toEqual([STRINGS.privateEvent]);
  });

  it('un evento privado no se puede abrir si no está en el modelo', () => {
    const { root, popup } = setup(makeData(), false);
    popup.applySelection(selection('d-secret', true));
    expect(root.hidden).toBe(true);
  });

  it('imágenes: carga diferida, sin referrer, con alt y pie; si fallan se retira la figura', () => {
    const data = makeData();
    data.events[0].media = [
      { type: 'image', url: 'https://example.com/a.png', alt: 'Foto A' },
      { type: 'image', url: 'https://example.com/b.png', alt: '' },
    ];
    const { root, popup } = setup(data);
    popup.applySelection(selection('a-school', true));

    const images = [...root.querySelectorAll<HTMLImageElement>('.popup__media img')];
    expect(images.map((image) => image.getAttribute('src'))).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    expect(images[0].alt).toBe('Foto A');
    expect(images[0].getAttribute('loading')).toBe('lazy');
    expect(images[0].getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(texts(root, 'figcaption')).toEqual(['Foto A']);

    images[0].dispatchEvent(new Event('error'));
    expect(root.querySelectorAll('.popup__figure')).toHaveLength(1);
    expect(root.querySelector('.popup__media img')).toBe(images[1]);
  });

  it('al cambiar de evento sustituye el contenido y vuelve arriba', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    const body = root.querySelector<HTMLElement>('.popup__body');
    if (!body) throw new Error('falta el cuerpo');
    body.scrollTop = 120;
    popup.applySelection(selection('c-side', true));
    expect(texts(root, '#popup-title')).toEqual(['Proyecto paralelo']);
    expect(root.querySelectorAll('#popup-title')).toHaveLength(1);
    expect(root.querySelector('.popup__skills')).toBeNull();
    expect(body.scrollTop).toBe(0);
    expect(root.style.getPropertyValue('--accent')).toBe('#B48CFF');
  });
});

describe('EventPopup: navegación y cierre', () => {
  it('los botones anterior/siguiente se desactivan según haya vecinos y avisan al controlador', () => {
    const { root, popup, handlers } = setup();
    popup.applySelection(selection('a-school', true, { hasPrevious: false, hasNext: true }));
    expect(prevButton(root).disabled).toBe(true);
    expect(nextButton(root).disabled).toBe(false);
    click(nextButton(root));
    expect(handlers.onNavigate).toHaveBeenCalledExactlyOnceWith('next');

    popup.applySelection(selection('a-school', true, { hasPrevious: true, hasNext: false }));
    expect(prevButton(root).disabled).toBe(false);
    expect(nextButton(root).disabled).toBe(true);
    click(prevButton(root));
    expect(handlers.onNavigate).toHaveBeenLastCalledWith('previous');
  });

  it('el botón de cerrar pide cerrar el detalle', () => {
    const { root, popup, handlers } = setup();
    popup.applySelection(selection('b-job', true));
    click(closeButton(root));
    expect(handlers.onDetailClosed).toHaveBeenCalledTimes(1);
    // El pop-up no se cierra solo: espera a que el controlador se lo confirme.
    expect(root.hidden).toBe(false);
  });

  it('se cierra cuando la selección deja de tener el detalle abierto', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    popup.applySelection(selection('b-job', false));
    expect(root.hidden).toBe(true);
    expect(popup.isOpen).toBe(false);
  });

  it('clic fuera lo cierra; dentro del pop-up o en zonas [data-keep-popup], no', () => {
    const { root, popup, handlers } = setup();
    const outside = mount('div');
    const stage = mount('div', { 'data-keep-popup': '' });
    const canvas = document.createElement('canvas');
    stage.append(canvas);

    pointerDown(outside);
    expect(handlers.onDetailClosed).not.toHaveBeenCalled(); // cerrado: nada que hacer

    popup.applySelection(selection('b-job', true));
    pointerDown(closeButton(root));
    pointerDown(root);
    pointerDown(canvas);
    pointerDown(stage);
    pointerDown(document);
    expect(handlers.onDetailClosed).not.toHaveBeenCalled();

    pointerDown(outside);
    expect(handlers.onDetailClosed).toHaveBeenCalledTimes(1);
  });

  it('el selector de zonas que no cierran es configurable', () => {
    const root = mount('aside');
    const popup = new EventPopup(root, '.keep');
    const handlers = fakeHandlers();
    popup.bind(handlers);
    popup.render(buildModel());
    popup.applySelection(selection('b-job', true));
    pointerDown(mount('div', { class: 'keep' }));
    expect(handlers.onDetailClosed).not.toHaveBeenCalled();
    pointerDown(mount('div', { 'data-keep-popup': '' }));
    expect(handlers.onDetailClosed).toHaveBeenCalledTimes(1);
  });
});

describe('EventPopup: gestión del foco', () => {
  it('al cerrar devuelve el foco al elemento que lo tenía al abrir', () => {
    const opener = mount('button');
    opener.focus();
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    expect(document.activeElement).toBe(root);
    popup.applySelection(selection('b-job', false));
    expect(document.activeElement).toBe(opener);
  });

  it('recuerda el elemento original aunque se navegue entre eventos con el pop-up abierto', () => {
    const opener = mount('button');
    opener.focus();
    const { popup } = setup();
    popup.applySelection(selection('a-school', true));
    popup.applySelection(selection('b-job', true));
    popup.applySelection(selection('c-side', true));
    popup.applySelection(selection(null, false));
    expect(document.activeElement).toBe(opener);
  });

  it('regresión (BUG-3): si el usuario ya ha llevado el foco a otro control, cerrar no se lo quita', () => {
    const opener = mount('button');
    const chip = mount('button', { 'data-keep-popup': '' });
    opener.focus();
    const { popup } = setup();
    popup.applySelection(selection('c-side', true));
    // P. ej. pulsa un chip de filtro que oculta el evento abierto: el foco está en el chip.
    chip.focus();
    popup.applySelection(selection(null, false));
    expect(document.activeElement).toBe(chip);
  });

  it('si el foco se había perdido (está en <body>), al cerrar vuelve al elemento original', () => {
    const opener = mount('button');
    opener.focus();
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    root.blur();
    expect(document.activeElement).toBe(document.body);
    popup.applySelection(selection('b-job', false));
    expect(document.activeElement).toBe(opener);
  });

  it('si el elemento original ya no está en el documento, no falla', () => {
    const opener = mount('button');
    opener.focus();
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    opener.remove();
    expect(() => popup.applySelection(selection(null, false))).not.toThrow();
    expect(root.hidden).toBe(true);
  });

  it('al navegar con los botones del propio pop-up el foco se queda en el botón', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('a-school', true));
    nextButton(root).focus();
    popup.applySelection(selection('b-job', true));
    expect(document.activeElement).toBe(nextButton(root));
  });

  it('si el foco está fuera al cambiar de evento (p. ej. flechas sobre la escena), vuelve al diálogo', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('a-school', true));
    mount('button').focus();
    popup.applySelection(selection('b-job', true));
    expect(document.activeElement).toBe(root);
  });

  it('reaplicar la misma selección no roba el foco ni repinta', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    const title = root.querySelector('#popup-title');
    closeButton(root).focus();
    popup.applySelection(selection('b-job', true, { hasNext: false }));
    expect(document.activeElement).toBe(closeButton(root));
    expect(root.querySelector('#popup-title')).toBe(title);
    expect(nextButton(root).disabled).toBe(true);
  });

  it('no atrapa el foco: Tab y Mayús+Tab salen del panel por el orden natural', () => {
    const { root, popup } = setup();
    popup.applySelection(selection('b-job', true));
    nextButton(root).focus();
    expect(press(nextButton(root), 'Tab').defaultPrevented).toBe(false);
    closeButton(root).focus();
    expect(press(closeButton(root), 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    root.focus();
    expect(press(root, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('otras teclas y Tab con el pop-up cerrado no se interceptan', () => {
    const { root, popup } = setup();
    expect(press(root, 'Tab').defaultPrevented).toBe(false);
    popup.applySelection(selection('b-job', true));
    nextButton(root).focus();
    expect(press(nextButton(root), 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(nextButton(root));
  });
});

describe('EventPopup: enlaces causales', () => {
  const causal = (): ReturnType<typeof makeData> => {
    const data = makeData();
    data.events[0].ledTo = ['b-job', 'd-secret'];
    data.events[1].ledTo = ['c-side'];
    return data;
  };

  it('«Esto llevó a…» lista los destinos visibles y abre el elegido', () => {
    const { root, handlers, popup } = setup(causal());
    popup.applySelection(selection('a-school', true));
    const section = root.querySelector('.popup__consequences');
    expect(section?.querySelector('h3')?.textContent).toBe(STRINGS.ledTo);
    const items = [...root.querySelectorAll<HTMLButtonElement>('.popup__consequences .popup__causal')];
    // El destino privado no aparece si no se muestran los privados.
    expect(items.map((item) => item.dataset.event)).toEqual(['b-job']);
    expect(items[0].getAttribute('aria-label')).toBe(STRINGS.goTo('Primer trabajo'));
    expect(items[0].style.getPropertyValue('--chip-color')).not.toBe('');
    click(items[0]);
    expect(handlers.onEventActivated).toHaveBeenCalledWith('b-job');
    expect(root.querySelector('.popup__causes')).toBeNull();
  });

  it('«Viene de…» lista los orígenes; un evento con ambos muestra las dos secciones', () => {
    const { root, handlers, popup } = setup(causal());
    popup.applySelection(selection('b-job', true));
    expect(root.querySelector('.popup__causes h3')?.textContent).toBe(STRINGS.cameFrom);
    const origin = button(root, '.popup__causes .popup__causal');
    expect(origin.dataset.event).toBe('a-school');
    expect(button(root, '.popup__consequences .popup__causal').dataset.event).toBe('c-side');
    click(origin);
    expect(handlers.onEventActivated).toHaveBeenCalledWith('a-school');
  });

  it('con privados visibles, también enlaza a ellos; sin ledTo no hay secciones', () => {
    const { root, popup } = setup(causal(), true);
    popup.applySelection(selection('a-school', true));
    expect([...root.querySelectorAll<HTMLButtonElement>('.popup__consequences .popup__causal')].map((item) => item.dataset.event)).toEqual([
      'b-job',
      'd-secret',
    ]);
    const plain = setup();
    plain.popup.applySelection(selection('a-school', true));
    expect(plain.root.querySelector('.popup__consequences, .popup__causes')).toBeNull();
  });
});
