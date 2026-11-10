import { afterEach, describe, expect, it } from 'vitest';
import { Hud } from '../../../src/infrastructure/dom/Hud';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, mount, texts, unsafeModel } from '../../helpers/dom';
import { buildModel, makeData, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

describe('Hud', () => {
  it('pinta nombre, titular, tagline y contacto, y actualiza título e idioma del documento', () => {
    const root = mount('header');
    new Hud(root).render(buildModel());

    expect(root.querySelector('h1.hud__owner')?.textContent).toBe('Ada Test');
    expect(root.querySelector('.hud__eyebrow')?.textContent).toBe('Vida de prueba');
    expect(root.querySelector('.hud__tagline')?.textContent).toBe('Una tagline');
    expect(document.title).toBe('Ada Test — Vida de prueba');
    expect(document.documentElement.lang).toBe('es');

    const links = [...root.querySelectorAll<HTMLAnchorElement>('.hud__contact a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href'), link.target, link.rel])).toEqual([
      ['Web', 'https://example.com/ada', '_blank', 'noopener noreferrer'],
    ]);
  });

  it('sin tagline ni contacto no deja elementos vacíos', () => {
    const data = makeData();
    delete data.meta.tagline;
    delete data.meta.contact;
    const root = mount('header');
    new Hud(root).render(buildModel(data));
    expect(root.querySelector('.hud__tagline')).toBeNull();
    expect(root.querySelector('.hud__contact')).toBeNull();
  });

  it('contador de eventos visibles, en una región aria-live', () => {
    const root = mount('header');
    const hud = new Hud(root);
    hud.render(buildModel());
    hud.applyFilter({ activeCategoryIds: new Set(['work']), visibleEventIds: new Set(['b-job', 'e-side-two']), totalEvents: 4 });
    const counter = root.querySelector('.hud__counter');
    expect(counter?.textContent).toBe('2 / 4 eventos');
    expect(counter?.getAttribute('aria-live')).toBe('polite');
    hud.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 4 });
    expect(counter?.textContent).toBe('0 / 4 eventos');
  });

  it('avisa de "datos de ejemplo" solo cuando la fuente es el ejemplo', () => {
    const personal = mount('header');
    new Hud(personal).render(buildModel(makeData(), { source: 'personal' }));
    expect(personal.querySelector('[data-testid="example-notice"]')).toBeNull();

    const example = mount('header');
    new Hud(example).render(buildModel(makeData(), { source: 'example' }));
    const notice = example.querySelector('[data-testid="example-notice"]');
    expect(notice?.textContent).toBe(STRINGS.exampleData);
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.getAttribute('title')).toBe(STRINGS.exampleDataHint);
  });

  it('volver a pintar sustituye el contenido en vez de duplicarlo', () => {
    const root = mount('header');
    const hud = new Hud(root);
    hud.render(buildModel());
    hud.render(buildModel());
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('.hud__counter')).toHaveLength(1);
  });

  it('se atenúa mientras el detalle está abierto', () => {
    const root = mount('header');
    const hud = new Hud(root);
    hud.applySelection(selection('b-job', true));
    expect(root.classList.contains('hud--dimmed')).toBe(true);
    hud.applySelection(selection('b-job', false));
    expect(root.classList.contains('hud--dimmed')).toBe(false);
  });

  it('showLoadError sustituye la cabecera por el error con role="alert"', () => {
    const root = mount('header');
    const hud = new Hud(root);
    hud.render(buildModel());
    hud.showLoadError('HTTP 500 <b>no</b>');
    expect(texts(root, 'h1')).toEqual([STRINGS.loadError]);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('HTTP 500 <b>no</b>');
    expect(alert?.children).toHaveLength(0);
    expect(root.querySelector('.hud__counter')).toBeNull();
  });

  it('seguridad: descarta contactos que no son http(s) y no interpreta HTML en los metadatos', () => {
    const root = mount('header');
    const model = unsafeModel(buildModel(), {
      meta: {
        owner: '<img src=x onerror="alert(1)">',
        tagline: '<script>alert(1)</script>',
        contact: [
          { label: 'malo', url: 'javascript:alert(1)' },
          { label: '<i>bueno</i>', url: 'https://example.com/ok' },
          { label: 'data', url: 'data:text/html,<script>alert(1)</script>' },
        ],
      },
    });
    new Hud(root).render(model);

    expect(root.querySelector('img, script, i')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('<img src=x onerror="alert(1)">');
    const links = [...root.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/ok');
    expect(links[0].textContent).toBe('<i>bueno</i>');
    expect(document.title).toContain('<img');
  });
});
