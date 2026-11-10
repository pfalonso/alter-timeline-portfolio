import { afterEach, describe, expect, it } from 'vitest';
import { LiveAnnouncer } from '../../../src/infrastructure/dom/LiveAnnouncer';
import { cleanupDom, mount } from '../../helpers/dom';
import { buildModel, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

describe('LiveAnnouncer', () => {
  it('es una región aria-live educada y atómica', () => {
    const root = mount('div');
    new LiveAnnouncer(root);
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-atomic')).toBe('true');
    expect(root.textContent).toBe('');
  });

  it('anuncia título, fechas y resumen del evento enfocado', () => {
    const root = mount('div');
    const announcer = new LiveAnnouncer(root);
    announcer.render(buildModel());
    announcer.applySelection(selection('a-school'));
    expect(root.textContent).toBe('Escuela. 2010 — 2014. Cuatro años de estudio.');
    announcer.applySelection(selection('c-side', true));
    expect(root.textContent).toMatch(/^Proyecto paralelo\. jun\.? 2016\. Una bifurcación\.$/);
  });

  it('no repite el anuncio si el evento enfocado no cambia (p. ej. al abrir su detalle)', () => {
    const root = mount('div');
    const announcer = new LiveAnnouncer(root);
    announcer.render(buildModel());
    announcer.applySelection(selection('a-school'));
    root.textContent = 'marcador';
    announcer.applySelection(selection('a-school', true));
    expect(root.textContent).toBe('marcador');
  });

  it('se vacía al soltar el foco o si el evento no existe', () => {
    const root = mount('div');
    const announcer = new LiveAnnouncer(root);
    announcer.render(buildModel());
    announcer.applySelection(selection('a-school'));
    announcer.applySelection(selection(null));
    expect(root.textContent).toBe('');
    announcer.applySelection(selection('a-school'));
    announcer.applySelection(selection('fantasma'));
    expect(root.textContent).toBe('');
  });

  it('sin modelo no anuncia nada', () => {
    const root = mount('div');
    new LiveAnnouncer(root).applySelection(selection('a-school'));
    expect(root.textContent).toBe('');
  });
});
