import { afterEach, describe, expect, it } from 'vitest';
import { eyebrowOf, Hud } from '../../../src/infrastructure/dom/Hud';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, mount, texts, unsafeModel } from '../../helpers/dom';
import { buildModel, makeData } from '../../helpers/fixtures';

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

  it('oficio, ubicación y disponibilidad bajo el nombre; el antetítulo no repite el nombre (U-01)', () => {
    const root = mount('header');
    const data = makeData();
    data.meta = { ...data.meta, title: 'Ada Test · línea a línea', headline: 'Ingeniera de pruebas', location: 'Bilbao', availability: 'Disponible ya' };
    new Hud(root).render(buildModel(data));
    expect(texts(root, '.hud__eyebrow')).toEqual(['línea a línea']);
    expect(texts(root, '.hud__headline')).toEqual(['Ingeniera de pruebas']);
    expect(texts(root, '.hud__where > span')).toEqual(['Bilbao', 'Disponible ya']);
    expect(document.title).toBe('Ada Test — Ingeniera de pruebas');
    // Sin contador en la cabecera (U-09): el recuento va junto a los filtros.
    expect(root.querySelector('.hud__counter')).toBeNull();
  });

  it('acciones de contacto: reel primero, CV (también ruta del sitio), correo copiable y el resto', () => {
    const root = mount('header');
    const data = makeData();
    data.meta = {
      ...data.meta,
      email: 'ada@example.com',
      cv: [{ label: 'CV (PDF)', url: '/cv/ada.pdf' }],
      contact: [
        { label: 'GitHub', url: 'https://github.com/ada' },
        { label: 'Demo reel', url: 'https://youtu.be/x' },
      ],
    };
    new Hud(root).render(buildModel(data));
    const actions = [...root.querySelectorAll<HTMLAnchorElement>('.hud__contact a')];
    expect(actions.map((link) => link.getAttribute('href'))).toEqual(['https://youtu.be/x', '/cv/ada.pdf', 'mailto:ada@example.com', 'https://github.com/ada']);
    expect(actions[0].classList.contains('action--primary')).toBe(true);
    expect(texts(root, '.action__text')).toEqual(['ada@example.com']);
    expect(root.querySelectorAll('.action__copy')).toHaveLength(1);
    expect(root.querySelectorAll('.hud__contact svg.icon')).toHaveLength(5);
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
    expect(root.querySelectorAll('.hud__contact')).toHaveLength(1);
  });

  it('eyebrowOf: quita el nombre del antetítulo y no deja nada si solo es el nombre', () => {
    expect(eyebrowOf('Ada', 'Ada · línea a línea')).toBe('línea a línea');
    expect(eyebrowOf('Ada', 'ada')).toBeNull();
    expect(eyebrowOf('Ada', 'Ada ·')).toBeNull();
    expect(eyebrowOf('Ada', 'Otra cosa')).toBe('Otra cosa');
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
