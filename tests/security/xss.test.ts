import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LifeData } from '../../src/domain/model';
import { LifeDataValidator, TimelineFactory } from '../../src/domain/services';
import { EventPopup } from '../../src/infrastructure/dom/EventPopup';
import { jsonFetch, mountApp } from '../helpers/app';
import { cleanupDom, mount, unsafeModel } from '../helpers/dom';
import { buildModel, makeData, NOW, selection } from '../helpers/fixtures';

declare global {
  interface Window {
    __xss?: string;
  }
}

afterEach(() => {
  cleanupDom();
  delete window.__xss;
  window.history.replaceState(null, '', '/');
});

const IMG = '<img src=x onerror="window.__xss=\'img\'">';
const SCRIPT = '<script>window.__xss="script"</script>';
const SVG = '<svg onload="window.__xss=\'svg\'"></svg>';
const ATTR = '" onmouseover="window.__xss=\'attr\'" x="';
const PAYLOAD = `${IMG}${SCRIPT}${SVG}${ATTR}`;

/** Datos VÁLIDOS para el validador (los textos son libres) con marcado hostil en todos los campos de texto. */
function hostileData(): LifeData {
  const data = makeData();
  data.meta.owner = `Owner ${PAYLOAD}`;
  data.meta.title = `Title ${PAYLOAD}`;
  data.meta.tagline = `Tagline ${PAYLOAD}`;
  data.meta.contact = [{ label: `Contact ${PAYLOAD}`, url: 'https://example.com/?q=<script>' }];
  for (const category of data.categories) {
    category.label = `${category.id} ${PAYLOAD}`;
    category.icon = IMG;
    category.description = PAYLOAD;
  }
  for (const event of data.events) {
    event.title = `T-${event.id} ${PAYLOAD}`;
    event.subtitle = PAYLOAD;
    event.summary = `S ${PAYLOAD}`;
    event.description = `${PAYLOAD}\n\n${PAYLOAD}`;
    event.location = PAYLOAD;
    event.organization = PAYLOAD;
    event.skills = [PAYLOAD];
    event.highlights = [PAYLOAD];
    event.links = [{ label: PAYLOAD, url: 'https://example.com/a' }];
    event.media = [{ type: 'image', url: 'https://example.com/a.png', alt: PAYLOAD }];
  }
  return data;
}

/** Elementos con manejadores en línea o que solo pueden venir de HTML inyectado. */
function injected(root: ParentNode): Element[] {
  const suspicious = [...root.querySelectorAll('script, svg, iframe, object, embed, style, link, form, [srcdoc]')];
  const inline = [...root.querySelectorAll('*')].filter((node) => node.getAttributeNames().some((name) => name.startsWith('on')));
  return [...suspicious, ...inline];
}

describe('seguridad: inyección de HTML desde el JSON', () => {
  it('el validador acepta texto con marcado (es texto) — la defensa está en el render', () => {
    expect(new LifeDataValidator().validate(hostileData()).issues).toEqual([]);
  });

  it('un título con <img onerror> no crea elementos ni ejecuta nada en ningún componente', async () => {
    const t = await mountApp(jsonFetch({ '/data/life.json': hostileData() }));
    expect(t.started).toBe(true);

    // Recorre todas las superficies que pintan contenido del JSON.
    t.tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    for (const id of ['a-school', 'b-job', 'c-side', 'e-side-two']) {
      t.controller.onEventActivated(id);
      expect(t.popup.querySelector('#popup-title')?.textContent).toBe(`T-${id} ${PAYLOAD}`);
      expect(injected(document)).toEqual([]);
      // Las únicas imágenes son las de `media`, creadas por el código con src http(s).
      const images = [...document.querySelectorAll('img')];
      expect(images.map((image) => image.getAttribute('src'))).toEqual(['https://example.com/a.png']);
      expect(images[0].getAttributeNames().sort()).toEqual(['alt', 'decoding', 'loading', 'referrerpolicy', 'src']);
      expect(images[0].alt).toBe(PAYLOAD);
    }
    t.controller.onNoCategories();
    t.controller.onAllCategories();
    t.controller.onEventActivated('a-school');

    expect(window.__xss).toBeUndefined();
    expect(injected(document)).toEqual([]);
    // El texto se ve literal en cada superficie.
    expect(t.hud.querySelector('h1')?.textContent).toBe(`Owner ${PAYLOAD}`);
    expect(t.filters.querySelector('.chip__label')?.textContent).toBe(`work ${PAYLOAD}`);
    expect(t.index.querySelector('.index__name')?.textContent).toBe(`T-a-school ${PAYLOAD}`);
    expect(t.tooltipRoot.querySelector('.tooltip__title')?.textContent).toBe(`T-a-school ${PAYLOAD}`);
    expect(t.labels.querySelector('.node-label__title')?.textContent).toBe(`T-a-school ${PAYLOAD}`);
    expect(t.announcer.textContent).toContain(IMG);
    expect(t.popup.querySelector('.popup__paragraph')?.textContent).toBe(PAYLOAD);
    expect(document.title).toContain(IMG);
  });

  it('el mensaje de error de carga también se pinta como texto', async () => {
    const t = await mountApp(() => Promise.reject(new Error(IMG)));
    expect(t.started).toBe(false);
    expect(t.hud.querySelector('[role="alert"]')?.textContent).toContain(IMG);
    expect(document.querySelector('img')).toBeNull();
  });

  it('el código de src/ no usa APIs que interpretan HTML o código', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk('src');
    expect(files.length).toBeGreaterThan(40);
    const forbidden = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|srcdoc)\b|\beval\s*\(|new Function\s*\(/;
    // Se ignoran los comentarios (dom.ts explica precisamente que NO usa innerHTML).
    const code = (file: string): string =>
      readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    const offenders = files.filter((file) => forbidden.test(code(file)));
    expect(forbidden.test('node.innerHTML = x')).toBe(true);
    expect(offenders).toEqual([]);
  });
});

describe('seguridad: URLs peligrosas', () => {
  const BAD_URLS = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com',
  ];

  it.each(BAD_URLS)('capa 1 — el validador rechaza %j en enlaces, contacto y media', (url) => {
    const data = makeData();
    data.meta.contact = [{ label: 'x', url }];
    data.events[0].links = [{ label: 'x', url }];
    data.events[0].media = [{ type: 'image', url, alt: 'x' }];
    const paths = new LifeDataValidator().validate(data).issues.map((issue) => issue.path);
    expect(paths).toEqual(['meta.contact[0].url', 'events[0].links[0].url', 'events[0].media[0].url']);
  });

  it('capa 1 — un life.json con una URL javascript: se descarta entero y se cargan los datos de ejemplo', async () => {
    const evil = makeData();
    evil.events[1].links = [{ label: 'pincha', url: 'javascript:window.__xss="link"' }];
    const t = await mountApp(jsonFetch({ '/data/life.json': evil, '/data/life.example.json': makeData() }));
    expect(t.hud.querySelector('[data-testid="example-notice"]')).not.toBeNull();
    t.controller.onEventActivated('b-job');
    expect([...t.popup.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['https://example.com/acme']);
  });

  it('capa 2 — la fábrica descarta las URLs peligrosas aunque el documento no se haya validado', () => {
    const data = makeData();
    data.events[1].links = [...BAD_URLS.map((url) => ({ label: 'x', url })), { label: 'ok', url: 'https://example.com/ok' }];
    data.events[1].media = BAD_URLS.map((url) => ({ type: 'image' as const, url, alt: 'x' }));
    const event = new TimelineFactory().create(data, { now: NOW }).getEvent('b-job');
    expect(event?.links).toEqual([{ label: 'ok', url: 'https://example.com/ok' }]);
    expect(event?.media).toEqual([]);
  });

  it('capa 3 — el pop-up no crea enlaces javascript: aunque el modelo los traiga', () => {
    const root = mount('aside');
    const popup = new EventPopup(root);
    popup.render(
      unsafeModel(buildModel(), {
        events: {
          'b-job': {
            links: [...BAD_URLS.map((url) => ({ label: 'malo', url })), { label: 'bueno', url: 'https://example.com/ok' }],
          },
          'a-school': { links: [{ label: 'malo', url: 'javascript:alert(1)' }] },
        },
      }),
    );

    popup.applySelection(selection('b-job', true));
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://example.com/ok']);
    expect(links[0].textContent).toBe('bueno ↗');

    // Si todos los enlaces se descartan, la sección "Enlaces" no aparece.
    popup.applySelection(selection('a-school', true));
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('.popup__links')).toBeNull();
  });

  it('todos los enlaces externos que llegan al DOM son http(s), con target=_blank y rel noopener noreferrer', async () => {
    const t = await mountApp(jsonFetch({ '/data/life.json': makeData() }));
    t.controller.onEventActivated('b-job');
    const anchors = [...document.querySelectorAll('a')];
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    for (const anchor of anchors) {
      expect(anchor.protocol).toMatch(/^https?:$/);
      expect(anchor.target).toBe('_blank');
      expect(anchor.relList.contains('noopener')).toBe(true);
      expect(anchor.relList.contains('noreferrer')).toBe(true);
    }
  });

  it('un color de categoría no puede colar CSS: el validador solo admite #RRGGBB', () => {
    const data = makeData();
    data.categories[0].color = 'red;background:url(https://evil.example.com/x)';
    expect(new LifeDataValidator().validate(data).issues.map((issue) => issue.path)).toEqual(['categories[0].color']);
  });
});
