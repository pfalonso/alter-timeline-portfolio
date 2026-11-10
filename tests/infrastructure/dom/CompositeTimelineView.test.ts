import { describe, expect, it, vi } from 'vitest';
import { CompositeTimelineView, type TimelineViewPart } from '../../../src/infrastructure/dom/CompositeTimelineView';
import { buildModel, fakeHandlers, selection } from '../../helpers/fixtures';

describe('CompositeTimelineView', () => {
  it('reparte cada llamada entre todas las piezas, en orden y con el mismo argumento', () => {
    const order: string[] = [];
    const part = (name: string): Required<TimelineViewPart> => ({
      bind: vi.fn(() => void order.push(`${name}.bind`)),
      render: vi.fn(() => void order.push(`${name}.render`)),
      applyFilter: vi.fn(() => void order.push(`${name}.filter`)),
      applySelection: vi.fn(() => void order.push(`${name}.selection`)),
      showLoadError: vi.fn(() => void order.push(`${name}.error`)),
    });
    const a = part('a');
    const b = part('b');
    const view = new CompositeTimelineView([a, b]);
    const handlers = fakeHandlers();
    const model = buildModel();
    const filter = { activeCategoryIds: new Set(['work']), visibleEventIds: new Set(['b-job']), totalEvents: 4 };
    const selected = selection('b-job', true);

    view.bind(handlers);
    view.render(model);
    view.applyFilter(filter);
    view.applySelection(selected);
    view.showLoadError('boom');

    expect(order).toEqual([
      'a.bind', 'b.bind', 'a.render', 'b.render', 'a.filter', 'b.filter', 'a.selection', 'b.selection', 'a.error', 'b.error',
    ]);
    for (const p of [a, b]) {
      expect(p.bind).toHaveBeenCalledWith(handlers);
      expect(p.render).toHaveBeenCalledWith(model);
      expect(p.applyFilter).toHaveBeenCalledWith(filter);
      expect(p.applySelection).toHaveBeenCalledWith(selected);
      expect(p.showLoadError).toHaveBeenCalledWith('boom');
    }
  });

  it('una pieza solo implementa lo que le interesa', () => {
    const onlyRender = { render: vi.fn() };
    const onlyError = { showLoadError: vi.fn() };
    const view = new CompositeTimelineView([onlyRender, {}, onlyError]);
    expect(() => {
      view.bind(fakeHandlers());
      view.render(buildModel());
      view.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0 });
      view.applySelection(selection(null));
      view.showLoadError('x');
    }).not.toThrow();
    expect(onlyRender.render).toHaveBeenCalledTimes(1);
    expect(onlyError.showLoadError).toHaveBeenCalledWith('x');
  });

  it('sin piezas no hace nada', () => {
    expect(() => new CompositeTimelineView([]).showLoadError('x')).not.toThrow();
  });
});
