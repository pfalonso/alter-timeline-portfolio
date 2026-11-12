import type { LifeEvent } from '../model/LifeEvent';
import type { Timeline } from '../model/Timeline';
import { braidChangesOf, isInBraidAt } from './Braid';
import { focusIntensityAt } from './LineFocus';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LayoutNode {
  readonly eventId: string;
  readonly position: Vec3;
  readonly branch: string;
  /** Posición ordinal (0…n−1) entre los nodos visibles. */
  readonly index: number;
  /** Para eventos con duración: puntos sobre la rama desde el inicio hasta el fin (o "hoy"). */
  readonly span?: readonly Vec3[];
  /** Líneas que pasan por el nodo: la dueña primero y, en un nodo de unión, las de `alsoBranches`. */
  readonly lines: readonly string[];
}

/** «Camino que no fue»: hebra corta que sale del nodo de origen y se disuelve. */
export interface LayoutGhost {
  readonly id: string;
  readonly originEventId: string;
  /** Polilínea de la hebra (≈ `ghostSteps` pasos), del origen hacia fuera. */
  readonly points: readonly Vec3[];
  /** Hacia dónde se aleja: 1 arriba, −1 abajo. */
  readonly side: 1 | -1;
}

/** Proyecto en activo: su línea, desde el nodo hasta el final, por donde avanza la punta. */
export interface LayoutActive {
  readonly eventId: string;
  readonly branch: string;
  readonly points: readonly Vec3[];
}

/** Hueco de una línea en pausa: entre `fromX` (donde termina de disolverse) y `toX` (donde renace). */
export interface LayoutGap {
  readonly fromX: number;
  readonly toX: number;
}

export interface LayoutBranch {
  readonly id: string;
  /** Polilínea muestreada de la rama, en orden creciente de X. */
  readonly points: readonly Vec3[];
  /** Evento del que nace (bifurcación); `null` para la central o si no tiene origen visible. */
  readonly originEventId: string | null;
  /** Carril: 0 = central; positivos arriba, negativos abajo (orden de reparto). */
  readonly lane: number;
  /** Altura (Y) del carril por el que viaja la línea entre sus nodos. */
  readonly laneY: number;
  /** `true` si la rama sigue viva hoy (no se desvanece al final). */
  readonly open: boolean;
  /** `true` para la línea central (`meta.mainBranch`). */
  readonly main: boolean;
  /** Intensidad de foco (0..1) en cada punto de `points` (todo 1 si la línea no declara foco). */
  readonly focus: readonly number[];
  /** Si la línea converge en otra: con cuál, en qué evento y dónde (último punto de la curva). */
  readonly merge: LayoutMerge | null;
  /** Pertenencia a la trenza (0..1) en cada punto: 1 en el centro, 0 en su carril exterior. */
  readonly braid: readonly number[];
  /** Pausas: `points` no tiene puntos dentro de estos huecos (la línea se corta en tramos). */
  readonly gaps: readonly LayoutGap[];
}

/** Tramos dibujables de una línea (separados por sus pausas), con su `braid`. */
export function branchPieces(branch: Pick<LayoutBranch, 'points' | 'braid' | 'gaps'>): { points: Vec3[]; braid: number[] }[] {
  const pieces: { points: Vec3[]; braid: number[] }[] = [{ points: [], braid: [] }];
  branch.points.forEach((point, i) => {
    const current = pieces[pieces.length - 1];
    const previous = current.points[current.points.length - 1];
    if (previous && branch.gaps.some((gap) => previous.x <= gap.fromX + EPS && point.x >= gap.toX - EPS)) {
      pieces.push({ points: [point], braid: [branch.braid[i]] });
    } else {
      current.points.push(point);
      current.braid.push(branch.braid[i]);
    }
  });
  return pieces.filter((piece) => piece.points.length >= 2);
}

export interface LayoutMerge {
  readonly into: string;
  readonly eventId: string;
  readonly position: Vec3;
}

/** Enlace causal («esto llevó a esto»): arco por encima de la banda, del nodo origen al destino. */
export interface LayoutLink {
  readonly from: string;
  readonly to: string;
  /** Línea del origen y del destino (la hebra mezcla sus colores). */
  readonly fromBranch: string;
  readonly toBranch: string;
  /** Polilínea de la hebra, del origen al destino. */
  readonly points: readonly Vec3[];
}

/** Capítulo proyectado sobre el eje X: abarca sus nodos (medio paso de margen a cada lado). */
export interface LayoutArc {
  readonly id: string;
  readonly startX: number;
  readonly endX: number;
}

/** Marca de año: en el primer nodo de cada año (solo donde cambia el año entre nodos consecutivos). */
export interface YearMark {
  readonly year: number;
  readonly x: number;
}

export interface LayoutBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface TimelineLayoutResult {
  readonly nodes: readonly LayoutNode[];
  readonly branches: readonly LayoutBranch[];
  readonly years: readonly YearMark[];
  readonly bounds: LayoutBounds;
  /** X correspondiente a "hoy" (medio paso largo tras el último nodo). */
  readonly nowX: number;
  /** Separación entre nodos consecutivos (paso constante del eje ordinal). */
  readonly nodeStep: number;
  /** Separación vertical entre carriles contiguos. */
  readonly laneSpacing: number;
  /** Arcos temporales (capítulos) en X, en orden; solo los que tienen nodos visibles. */
  readonly arcs: readonly LayoutArc[];
  /** Enlaces causales entre eventos visibles. */
  readonly links: readonly LayoutLink[];
  /** Banda narrativa: extensión vertical de los nodos (trenza en y = 0, fuera de foco en su carril). */
  readonly band: { readonly minY: number; readonly maxY: number };
  /** Uniones, separaciones y fusiones con la trenza (para las chispas). */
  readonly junctions: readonly LayoutJunction[];
  /** Composición de la trenza a lo largo del eje X (tramos contiguos, de `bounds.minX` a `bounds.maxX`). */
  readonly braidSpans: readonly BraidSpan[];
  /** «Caminos que no fueron» con origen visible. */
  readonly ghosts: readonly LayoutGhost[];
  /** Proyectos en activo visibles y su prolongación hasta hoy. */
  readonly actives: readonly LayoutActive[];
}

export interface LayoutOptions {
  /** Distancia en X entre nodos consecutivos (eje ordinal: no depende de las fechas). */
  readonly nodeStep: number;
  /** Carril más cercano a la banda, en fracciones de `nodeStep`. */
  readonly laneMin: number;
  /** Carril más alejado de la banda, en fracciones de `nodeStep`. */
  readonly laneMax: number;
  /** Retroceso en Z del carril más alejado (las líneas pasan por detrás de los nodos). */
  readonly laneDepth: number;
  /** Retroceso en Z de la trenza para que pase por detrás de los símbolos que viajan en ella. */
  readonly mainBehind: number;
  /** Media longitud de la curva con la que una línea se une a la trenza o se separa, en fracciones de `nodeStep`. */
  readonly ramp: number;
  /** Distancia en X entre muestras de la polilínea. */
  readonly sampleStep: number;
  /** Margen antes del primer nodo, en pasos. */
  readonly padSteps: number;
  /** Distancia de "hoy" tras el último nodo, en pasos. */
  readonly nowSteps: number;
  /** Prolongación (desvaneciéndose) de una rama cerrada tras su último nodo, en pasos. */
  readonly tailSteps: number;
  /** Altura mínima y máxima de los arcos causales; crecen `linkRise` por paso salvado. */
  readonly linkMinHeight: number;
  readonly linkMaxHeight: number;
  readonly linkRise: number;
  /** Longitud de un «camino que no fue», en pasos. */
  readonly ghostSteps: number;
  /** Cuánto se aleja (en Y) un camino que no fue, en pasos. */
  readonly ghostDrift: number;
  /** Lo que tarda en disolverse una línea tras el inicio de su pausa, en pasos. */
  readonly pauseTail: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeStep: 3.6,
  laneMin: 0.5,
  laneMax: 0.8,
  laneDepth: 0.9,
  mainBehind: 0.25,
  ramp: 0.7,
  sampleStep: 0.3,
  padSteps: 1.2,
  nowSteps: 0.8,
  tailSteps: 0.7,
  linkMinHeight: 1.6,
  linkMaxHeight: 6.5,
  linkRise: 0.45,
  ghostSteps: 1.25,
  ghostDrift: 0.3,
  pauseTail: 0.55,
};

/** Rampa de un cambio de altura: de `from` a `to` entre `center − half` y `center + half`. */
interface Ramp {
  readonly center: number;
  readonly half: number;
  readonly from: number;
  readonly to: number;
  /** Salto oculto dentro del hueco de una pausa (no es una unión ni una separación). */
  readonly hidden?: boolean;
}

/** Punto por el que la línea pasa a una altura fija (origen, nodo propio, fusión, extremos). */
interface Station {
  readonly x: number;
  readonly y: number;
  readonly year: number;
  /** Tras esta estación empieza el hueco de una pausa (no hay rampas hasta la siguiente). */
  readonly gap?: boolean;
}

/** Pausa ya situada en X: la línea llega a `fromX`, se disuelve hasta `gapX` y renace en `toX`. */
interface PlannedPause {
  readonly fromX: number;
  readonly gapX: number;
  readonly toX: number;
  readonly from: LifeEvent | null;
  readonly to: LifeEvent | null;
  readonly fromYear: number;
  readonly toYear: number;
}

interface BranchPlan {
  readonly id: string;
  readonly main: boolean;
  readonly order: number;
  /** Eventos visibles de la línea, en orden ordinal. */
  readonly events: readonly LifeEvent[];
  /** Nodos de unión visibles por los que pasa sin ser la dueña. */
  readonly unions: readonly LifeEvent[];
  /** Pausas dentro de su vida visible. */
  readonly pauses: readonly PlannedPause[];
  /** X de los nodos de unión por los que pasa (propios o ajenos). */
  readonly knotXs: readonly number[];
  origin: LifeEvent | null;
  merge: { readonly event: LifeEvent; readonly into: string; readonly x: number } | null;
  startX: number;
  endX: number;
  open: boolean;
  /** `true` si en algún momento viaja fuera de la trenza (necesita carril). */
  needsLane: boolean;
  /** Línea exterior junto a la que conviene su carril: la de su origen o su fusión, si ocurren fuera de la trenza. */
  readonly beside: string | null;
  lane: number;
  laneY: number;
  laneZ: number;
  ramps: Ramp[];
  /** Altura antes de la primera rampa. */
  startY: number;
}

/** Unión/separación con la trenza, fusión, nacimiento (origen o renacer tras una pausa) y deshilachado (inicio de una pausa). */
export type JunctionKind = 'join' | 'split' | 'merge' | 'birth' | 'fray';

/** Unión, separación o fusión con la trenza (en y = 0), nacimiento o deshilachado de una línea. */
export interface LayoutJunction {
  readonly branch: string;
  readonly kind: JunctionKind;
  readonly position: Vec3;
}

/** Tramo del eje X con la misma composición de la trenza. */
export interface BraidSpan {
  readonly startX: number;
  readonly endX: number;
  /** Líneas en la trenza, en el orden de `branchIds`. */
  readonly members: readonly string[];
}

const MAX_LANE = 64;
const EPS = 1e-6;

/** Curva de Hermite con tangentes horizontales: monótona y sin *overshoot*. */
export const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const round = (value: number): number => Math.round(value * 1000) / 1000 || 0;

/**
 * Orden ordinal: fecha, después importancia (mayor primero), la línea central antes que las demás
 * y, por último, el id. Determinista.
 */
export function compareOrdinal(a: LifeEvent, b: LifeEvent, mainBranch: string): number {
  return (
    a.start.toDecimalYear() - b.start.toDecimalYear() ||
    b.importance - a.importance ||
    Number(b.branch === mainBranch) - Number(a.branch === mainBranch) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Posiciona nodos y líneas. Puro y determinista: mismo `Timeline` (y mismos visibles) → mismo
 * resultado. El eje X es **ordinal**: los nodos visibles, en orden cronológico, se separan siempre
 * `nodeStep`, sin escala temporal. El centro (y = 0) es la **trenza**: por ella viajan juntas las
 * líneas en foco en cada fecha (ver `Braid`). Las demás van rectas por su carril exterior, fijo para
 * toda su vida. Una línea se une a la trenza o se separa con una curva corta y monótona (sin
 * *overshoot*) entre dos de sus nodos; cada nodo está en la trenza o en el carril de su línea, según
 * el foco de la línea en su fecha.
 */
export class TimelineLayout {
  private readonly options: LayoutOptions;

  constructor(options: Partial<LayoutOptions> = {}) {
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  }

  compute(timeline: Timeline, visibleIds?: ReadonlySet<string>): TimelineLayoutResult {
    const o = this.options;
    const step = o.nodeStep;
    const isVisible = (event: LifeEvent | undefined): event is LifeEvent =>
      event !== undefined && (visibleIds === undefined || visibleIds.has(event.id));
    const ordered = timeline.events.filter(isVisible).sort((a, b) => compareOrdinal(a, b, timeline.mainBranch));
    const nodeX = new Map(ordered.map((event, index) => [event.id, index * step]));
    const lastNodeX = Math.max(0, (ordered.length - 1) * step);
    const now = timeline.now.toDecimalYear();
    const nowX = ordered.length > 0 ? lastNodeX + o.nowSteps * step : 0;
    const firstX = -o.padSteps * step;
    const endX = nowX + o.padSteps * step * 0.5;
    const yearAtX = this.yearScale(ordered, nowX, now);
    const xAtYear = (year: number): number => this.inverse(ordered, nowX, now, year);

    const plans = this.planBranches(timeline, ordered, nodeX, isVisible, { firstX, endX, now, xAtYear });
    const laneSpacing = this.assignLanes(plans);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    // Cada nodo, en la trenza si su línea (o alguna de las que pasan por él) está en ella en su
    // fecha; si no, en el carril de su línea.
    const inBraid = (event: LifeEvent): boolean =>
      event.lineIds.some((id) => planById.has(id) && isInBraidAt(timeline, id, event.start.toDecimalYear()));
    const nodeY = new Map(
      ordered.map((event) => {
        const plan = planById.get(event.branch) as BranchPlan;
        return [event.id, inBraid(event) ? 0 : plan.laneY] as const;
      }),
    );
    for (const plan of plans) this.planRamps(timeline, plan, nodeX, nodeY, xAtYear, { now });

    const nodes: LayoutNode[] = ordered.map((event, index) => {
      const x = nodeX.get(event.id) as number;
      const plan = planById.get(event.branch) as BranchPlan;
      const y = nodeY.get(event.id) as number;
      const node: LayoutNode = {
        eventId: event.id,
        position: { x: round(x), y: round(y), z: round(this.depthAt(plan, y) + (y === 0 ? o.mainBehind : 0)) },
        branch: event.branch,
        index,
        lines: event.lineIds.filter((id) => planById.has(id)),
      };
      if (!event.isRange) return node;
      const spanEnd = Math.min(plan.endX, event.ongoing ? nowX : xAtYear((event.end ?? event.start).toDecimalYear()));
      if (spanEnd - x < o.sampleStep) return node;
      return { ...node, span: this.sample(plan, x, spanEnd) };
    });

    const branches: LayoutBranch[] = plans.map((plan) => {
      const points = this.sample(plan, plan.startX, plan.endX);
      const line = timeline.getLine(plan.id);
      return {
        id: plan.id,
        points,
        originEventId: plan.origin?.id ?? null,
        lane: plan.lane,
        laneY: round(plan.laneY),
        open: plan.open,
        main: plan.main,
        focus: points.map((point) => focusIntensityAt(line, yearAtX(point.x))),
        merge: plan.merge ? { into: plan.merge.into, eventId: plan.merge.event.id, position: points[points.length - 1] } : null,
        braid: points.map((point) => round(this.braidWeight(plan, point.y))),
        gaps: plan.pauses.map((pause) => ({ fromX: round(pause.gapX), toX: round(pause.toX) })),
      };
    });

    const byId = new Map(nodes.map((node) => [node.eventId, node]));
    // Un arco causal solo aporta si une nodos que la propia línea no conecta ya: si origen y destino
    // comparten una línea y no hay ningún otro nodo de esa línea entre ellos, la línea ya es el puente.
    const linesOfEvent = new Map(ordered.map((event) => [event.id, [event.branch, ...event.alsoBranches]]));
    const indexOf = new Map(ordered.map((event, index) => [event.id, index]));
    const alreadyConnected = (from: string, to: string): boolean => {
      const fromLines = linesOfEvent.get(from) ?? [];
      const toLines = linesOfEvent.get(to) ?? [];
      const shared = fromLines.filter((line) => toLines.includes(line));
      if (shared.length === 0) return false;
      const i = indexOf.get(from) as number;
      const j = indexOf.get(to) as number;
      const between = ordered.slice(Math.min(i, j) + 1, Math.max(i, j));
      return shared.some((line) => !between.some((event) => (linesOfEvent.get(event.id) ?? []).includes(line)));
    };
    const links: LayoutLink[] = timeline.causalLinks.flatMap((link) => {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b || b.position.x <= a.position.x) return [];
      if (alreadyConnected(link.from, link.to)) return [];
      return [{ from: link.from, to: link.to, fromBranch: a.branch, toBranch: b.branch, points: this.arch(a.position, b.position) }];
    });

    const years: YearMark[] = [];
    ordered.forEach((event, index) => {
      const year = event.start.year;
      if (index === 0 || ordered[index - 1].start.year !== year) years.push({ year, x: round(index * step) });
    });

    const arcs: LayoutArc[] = timeline.arcs.flatMap((arc, index) => {
      const xs = ordered.filter((event) => timeline.arcOf(event)?.id === arc.id).map((event) => nodeX.get(event.id) as number);
      if (xs.length === 0) return [];
      const last = index === timeline.arcs.length - 1;
      const start = Math.min(...xs) - step / 2;
      const end = Math.max(...xs) + step / 2;
      return [{ id: arc.id, startX: round(start), endX: round(last && arc.end === null ? Math.max(end, endX) : end) }];
    });

    let minY = 0;
    let maxY = 0;
    for (const point of [...branches.flatMap((branch) => branch.points), ...links.flatMap((link) => link.points)]) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const nodeYs = nodes.map((node) => node.position.y);
    return {
      nodes,
      branches,
      years,
      bounds: { minX: round(firstX), maxX: round(endX), minY, maxY },
      nowX: round(nowX),
      nodeStep: step,
      laneSpacing: round(laneSpacing),
      arcs,
      links,
      band: { minY: Math.min(0, ...nodeYs), maxY: Math.max(0, ...nodeYs) },
      junctions: this.junctions(plans),
      braidSpans: this.braidSpans(plans, firstX, endX),
      ghosts: this.ghosts(timeline, byId),
      actives: this.actives(ordered, nodeX, planById),
    };
  }

  /** Caminos que no fueron: salen del nodo de origen, se alejan de la banda y se acaban enseguida. */
  private ghosts(timeline: Timeline, byId: ReadonlyMap<string, LayoutNode>): LayoutGhost[] {
    const o = this.options;
    const perOrigin = new Map<string, number>();
    return timeline.ghostLines.flatMap((line) => {
      const origin = byId.get(line.originEventId ?? '');
      if (!origin) return [];
      const k = perOrigin.get(origin.eventId) ?? 0;
      perOrigin.set(origin.eventId, k + 1);
      const p = origin.position;
      const side: 1 | -1 = p.y !== 0 ? (p.y > 0 ? 1 : -1) : k % 2 === 0 ? 1 : -1;
      const length = o.ghostSteps * o.nodeStep;
      const steps = Math.max(4, Math.ceil(length / o.sampleStep));
      const points: Vec3[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const s = i / steps;
        points.push({
          x: round(p.x + length * s),
          y: round(p.y + side * o.ghostDrift * o.nodeStep * smoothstep(s * 1.4)),
          z: round(p.z - 0.25 * s),
        });
      }
      return [{ id: line.id, originEventId: origin.eventId, points, side }];
    });
  }

  /** Proyectos en activo: tramo de su línea desde el nodo hasta el final (o la primera pausa). */
  private actives(
    ordered: readonly LifeEvent[],
    nodeX: ReadonlyMap<string, number>,
    planById: ReadonlyMap<string, BranchPlan>,
  ): LayoutActive[] {
    return ordered.flatMap((event) => {
      const plan = planById.get(event.branch);
      if (!event.active || !plan) return [];
      const x = nodeX.get(event.id) as number;
      const cut = plan.pauses.find((pause) => pause.gapX > x)?.gapX ?? plan.endX;
      if (cut - x < this.options.sampleStep) return [];
      return [{ eventId: event.id, branch: plan.id, points: this.sample(plan, x, cut) }];
    });
  }

  /** Año decimal en una X (lineal a trozos entre nodos; de "hoy" en adelante, hoy). */
  private yearScale(ordered: readonly LifeEvent[], nowX: number, now: number): (x: number) => number {
    const step = this.options.nodeStep;
    const years = ordered.map((event) => event.start.toDecimalYear());
    return (x: number): number => {
      if (years.length === 0) return now;
      if (x <= 0) return years[0];
      const i = Math.floor(x / step);
      if (i >= years.length - 1) {
        const last = years[years.length - 1];
        const t = Math.min(1, (x - (years.length - 1) * step) / Math.max(EPS, nowX - (years.length - 1) * step));
        return last + (Math.max(last, now) - last) * t;
      }
      return years[i] + (years[i + 1] - years[i]) * (x / step - i);
    };
  }

  /** X de un año decimal (inversa de `yearScale`): para el final de los periodos y los cambios de foco. */
  private inverse(ordered: readonly LifeEvent[], nowX: number, now: number, year: number): number {
    const step = this.options.nodeStep;
    const years = ordered.map((event) => event.start.toDecimalYear());
    if (years.length === 0 || year <= years[0]) return 0;
    for (let i = 1; i < years.length; i += 1) {
      if (years[i] >= year) return (i - 1 + (year - years[i - 1]) / Math.max(EPS, years[i] - years[i - 1])) * step;
    }
    const lastX = (years.length - 1) * step;
    const last = years[years.length - 1];
    return lastX + (nowX - lastX) * Math.min(1, (year - last) / Math.max(EPS, now - last));
  }

  private planBranches(
    timeline: Timeline,
    ordered: readonly LifeEvent[],
    nodeX: ReadonlyMap<string, number>,
    isVisible: (event: LifeEvent | undefined) => event is LifeEvent,
    span: { firstX: number; endX: number; now: number; xAtYear: (year: number) => number },
  ): BranchPlan[] {
    const o = this.options;
    const step = o.nodeStep;
    const plans: BranchPlan[] = [];
    timeline.branchIds.forEach((id, order) => {
      const events = ordered.filter((event) => event.branch === id);
      const unions = ordered.filter((event) => event.alsoBranches.includes(id));
      const main = id === timeline.mainBranch;
      if (!main && events.length === 0 && unions.length === 0) return;
      const anchors = [...events, ...unions].map((event) => nodeX.get(event.id) as number).sort((a, b) => a - b);
      const line = timeline.getLine(id);
      const first = anchors[0] ?? span.firstX;
      const last = anchors[anchors.length - 1] ?? span.firstX;
      // Origen visible y anterior al primer nodo: la línea sale de él.
      const originEvent = timeline.originOf(id);
      // Origen visible y anterior al primer nodo (o su propio primer nodo: nace en él).
      const origin =
        isVisible(originEvent) &&
        ((nodeX.get(originEvent.id) as number) < first - EPS || (originEvent.branch === id && (nodeX.get(originEvent.id) as number) <= first + EPS))
          ? originEvent
          : null;
      const mergeInfo = main ? undefined : timeline.mergeOf(id);
      const merge =
        mergeInfo && isVisible(mergeInfo.event) && (nodeX.get(mergeInfo.event.id) as number) > last + EPS
          ? { event: mergeInfo.event, into: mergeInfo.branch, x: nodeX.get(mergeInfo.event.id) as number }
          : null;
      const open = !merge && (main || events.some((event) => event.ongoing || event.active) || line?.untilPresent === true);
      // La central existe desde el principio salvo que declare `origin`.
      const declaredOrigin = timeline.getLine(id)?.originEventId !== undefined;
      const startX = origin ? (nodeX.get(origin.id) as number) : main && !declaredOrigin ? span.firstX : first - o.padSteps * step * 0.75;
      // Necesita carril si alguno de sus nodos o algún tramo de su vida queda fuera de la trenza.
      const from = origin ? origin.start.toDecimalYear() : -Infinity;
      const to = merge ? merge.event.start.toDecimalYear() : span.now;
      const outside =
        [...events, ...unions].some((event) => !isInBraidAt(timeline, id, event.start.toDecimalYear())) ||
        braidChangesOf(timeline, id, from, to).length > 0 ||
        (events.length === 0 && !isInBraidAt(timeline, id, span.now));
      const planEndX = merge ? merge.x : open ? span.endX : last + o.tailSteps * step;
      plans.push({
        id,
        main,
        order,
        events,
        unions,
        // Nudos (uniones) y el origen: ahí la línea ya tiene su chispa o su nudo.
        knotXs: [...events, ...unions, ...(origin ? [origin] : [])]
          .filter((event) => event.isUnion || event === origin)
          .map((event) => nodeX.get(event.id) as number),
        pauses: this.planPauses(timeline, id, nodeX, isVisible, span.xAtYear, startX, planEndX),
        origin,
        merge,
        startX,
        endX: planEndX,
        open,
        needsLane: outside || !main,
        beside:
          merge && !isInBraidAt(timeline, merge.into, to)
            ? merge.into
            : origin && !isInBraidAt(timeline, origin.branch, from)
              ? origin.branch
              : null,
        lane: 0,
        laneY: 0,
        laneZ: 0,
        ramps: [],
        startY: 0,
      });
    });
    return plans;
  }

  /** Pausas de la línea situadas en X (solo las que caen dentro de su vida visible). */
  private planPauses(
    timeline: Timeline,
    id: string,
    nodeX: ReadonlyMap<string, number>,
    isVisible: (event: LifeEvent | undefined) => event is LifeEvent,
    xAtYear: (year: number) => number,
    startX: number,
    endX: number,
  ): PlannedPause[] {
    const tail = this.options.pauseTail * this.options.nodeStep;
    return (timeline.getLine(id)?.pauses ?? []).flatMap((pause) => {
      const from = timeline.getEvent(pause.fromEventId);
      const to = timeline.getEvent(pause.toEventId);
      const fromYear = pause.from.toDecimalYear();
      const toYear = pause.to.toDecimalYear();
      const fromX = isVisible(from) ? (nodeX.get(from.id) as number) : xAtYear(fromYear);
      const toX = isVisible(to) ? (nodeX.get(to.id) as number) : xAtYear(toYear);
      if (toX - fromX < EPS || fromX <= startX + EPS || toX >= endX - EPS) return [];
      const gapX = fromX + Math.min(tail, (toX - fromX) * 0.45);
      return [{ fromX, gapX, toX, from: isVisible(from) ? from : null, to: isVisible(to) ? to : null, fromYear, toYear }];
    });
  }

  /**
   * Carriles exteriores fijos, como un *interval scheduling*: cada línea (por orden de nacimiento)
   * ocupa el carril libre más cercano a la trenza del lado de la línea en la que converge o de la
   * que nace (si tienen carril) o, si no, del lado con menos líneas vivas (a igualdad, arriba); los de
   * líneas ya cerradas se reutilizan. Una línea que nunca sale de la trenza no tiene
   * carril. Alturas en `[laneMin, laneMax] × nodeStep`. Devuelve la separación entre carriles.
   */
  private assignLanes(plans: BranchPlan[]): number {
    const o = this.options;
    const step = o.nodeStep;
    const gap = step * 0.5;
    const occupiedUntil = new Map<number, number>();
    const side = plans.filter((plan) => plan.needsLane).sort((a, b) => a.startX - b.startX || a.order - b.order);
    for (const plan of side) {
      let up = 0;
      let down = 0;
      for (const [lane, until] of occupiedUntil) {
        if (until + gap <= plan.startX) continue;
        if (lane > 0) up += 1;
        else down += 1;
      }
      // Del lado de la línea en la que converge o de la que nace (sin cruzar la trenza); si no, del
      // lado con menos líneas vivas.
      const related = plans.find((other) => other.id === plan.beside)?.lane ?? 0;
      const sign = related !== 0 ? Math.sign(related) : up <= down ? 1 : -1;
      let n = 1;
      while (n < MAX_LANE && (occupiedUntil.get(sign * n) ?? -Infinity) + gap > plan.startX) n += 1;
      plan.lane = sign * n;
      occupiedUntil.set(plan.lane, plan.endX);
    }
    const maxLevel = Math.max(1, ...plans.map((plan) => Math.abs(plan.lane)));
    const spacing = maxLevel > 1 ? ((o.laneMax - o.laneMin) * step) / (maxLevel - 1) : 0;
    for (const plan of plans) {
      if (plan.lane === 0) continue;
      const level = Math.abs(plan.lane);
      plan.laneY = Math.sign(plan.lane) * (o.laneMin * step + spacing * (level - 1));
      plan.laneZ = -o.laneDepth * (level / maxLevel);
    }
    return spacing;
  }

  /**
   * Rampas de la línea. Entre cada par de estaciones contiguas (origen, nodos propios, fusión y
   * extremos) se encadenan: la salida del origen hacia su estado, las uniones/separaciones de foco
   * que caen entre sus fechas y la llegada a la altura de la siguiente estación. Cada rampa se coloca
   * lo más cerca posible de su fecha, sin solaparse con las demás ni invadir las estaciones.
   */
  private planRamps(
    timeline: Timeline,
    plan: BranchPlan,
    nodeX: ReadonlyMap<string, number>,
    nodeY: ReadonlyMap<string, number>,
    xAtYear: (year: number) => number,
    context: { now: number },
  ): void {
    const o = this.options;
    const levelAt = (year: number): number => (isInBraidAt(timeline, plan.id, year) ? 0 : plan.laneY);
    const stations: Station[] = [];
    const passes = [...plan.events, ...plan.unions].sort((a, b) => (nodeX.get(a.id) as number) - (nodeX.get(b.id) as number));
    const firstYear = passes[0]?.start.toDecimalYear() ?? context.now;
    if (plan.origin) {
      const year = plan.origin.start.toDecimalYear();
      stations.push({ x: plan.startX, y: nodeY.get(plan.origin.id) ?? 0, year });
    } else stations.push({ x: plan.startX, y: levelAt(firstYear), year: firstYear });
    // Nodos propios y nodos de unión: la línea pasa exactamente por ellos.
    const middle: Station[] = passes.map((event) => ({
      x: nodeX.get(event.id) as number,
      y: nodeY.get(event.id) as number,
      year: event.start.toDecimalYear(),
    }));
    // Pausas: llega a `from` (por el nodo si pasa por él), se disuelve recta y renace en `to`.
    const passesBy = (event: LifeEvent | null): event is LifeEvent => event !== null && event.lineIds.includes(plan.id);
    for (const pause of plan.pauses) {
      const fromY = passesBy(pause.from) ? (nodeY.get(pause.from.id) as number) : levelAt(pause.fromYear - 1e-4);
      const toY = passesBy(pause.to) ? (nodeY.get(pause.to.id) as number) : levelAt(pause.toYear + 1e-4);
      middle.push({ x: pause.fromX, y: fromY, year: pause.fromYear });
      middle.push({ x: pause.gapX, y: fromY, year: pause.fromYear, gap: true });
      middle.push({ x: pause.toX, y: toY, year: pause.toYear });
    }
    middle.sort((a, b) => a.x - b.x);
    for (const station of middle) {
      // Una misma X (nodo propio o de unión que además es borde de pausa) es una sola estación.
      if (Math.abs(station.x - stations[stations.length - 1].x) > EPS) stations.push(station);
    }
    if (plan.merge) stations.push({ x: plan.endX, y: nodeY.get(plan.merge.event.id) ?? 0, year: plan.merge.event.start.toDecimalYear() });
    else {
      const last = stations[stations.length - 1];
      const year = plan.open ? Math.max(last.year, context.now) : last.year;
      stations.push({ x: plan.endX, y: plan.open ? levelAt(year) : last.y, year });
    }

    plan.startY = stations[0].y;
    const ramp = o.ramp * o.nodeStep;
    for (let i = 0; i + 1 < stations.length; i += 1) {
      const a = stations[i];
      const b = stations[i + 1];
      if (b.x - a.x < EPS) continue;
      // La cola antes del hueco va recta (se disuelve a la altura del nodo donde empieza la pausa).
      if (b.gap) continue;
      if (a.gap) {
        // Dentro del hueco no se dibuja nada: el salto de altura queda oculto.
        if (a.y !== b.y) plan.ramps.push({ center: (a.x + b.x) / 2, half: (b.x - a.x) / 4, from: a.y, to: b.y, hidden: true });
        continue;
      }
      // Secuencia de alturas y posición preferida de cada cambio.
      const wanted: { to: number; x: number }[] = [];
      let current = a.y;
      const after = levelAt(a.year + 1e-4);
      // Tras el origen, un nodo de unión o un renacer, la línea vuelve enseguida a su altura.
      if ((i > 0 || plan.origin) && after !== current) {
        wanted.push({ to: after, x: a.x });
        current = after;
      }
      for (const change of braidChangesOf(timeline, plan.id, a.year, b.year)) {
        const to = change.kind === 'join' ? 0 : plan.laneY;
        if (to === current) continue;
        wanted.push({ to, x: xAtYear(change.year) });
        current = to;
      }
      if (current !== b.y) wanted.push({ to: b.y, x: b.x });
      if (wanted.length === 0) continue;
      const half = Math.min(ramp, (b.x - a.x) / (2 * wanted.length));
      let from = a.y;
      let floor = a.x;
      wanted.forEach((item, k) => {
        const lo = floor + half;
        const hi = b.x - half - (wanted.length - 1 - k) * 2 * half;
        const center = Math.min(hi, Math.max(lo, item.x));
        plan.ramps.push({ center, half, from, to: item.to });
        from = item.to;
        floor = center + half;
      });
    }
  }

  /** Altura de la línea en X: constante entre rampas; dentro de cada una, *smoothstep* (sin overshoot). */
  private heightAt(plan: BranchPlan, x: number): number {
    let y = plan.startY;
    for (const ramp of plan.ramps) {
      if (x <= ramp.center - ramp.half) return y;
      if (x < ramp.center + ramp.half) return ramp.from + (ramp.to - ramp.from) * smoothstep((x - (ramp.center - ramp.half)) / (2 * ramp.half));
      y = ramp.to;
    }
    return y;
  }

  /** Pertenencia a la trenza (0..1) a una altura: 1 en y = 0, 0 en su carril (o más lejos). */
  private braidWeight(plan: BranchPlan, y: number): number {
    if (plan.laneY === 0) return y === 0 ? 1 : 0;
    return 1 - Math.min(1, Math.abs(y) / Math.abs(plan.laneY));
  }

  /** Profundidad: la trenza un poco por detrás de los símbolos; los carriles, más atrás. */
  private depthAt(plan: BranchPlan, y: number): number {
    const w = this.braidWeight(plan, y);
    return plan.laneZ * (1 - w) - this.options.mainBehind * w;
  }

  /** Uniones y separaciones (donde la rampa toca la trenza) y fusiones (al final de la línea). */
  private junctions(plans: readonly BranchPlan[]): LayoutJunction[] {
    const out: LayoutJunction[] = [];
    for (const plan of plans) {
      // Al entrar y salir de un nodo de unión no hay chispas: el nudo ya se lee por sí mismo.
      const atKnot = (x: number): boolean => plan.knotXs.some((kx) => Math.abs(kx - x) < 1e-3);
      for (const ramp of plan.ramps) {
        if (ramp.hidden) continue;
        if (ramp.to === 0 && ramp.from !== 0) {
          if (atKnot(ramp.center + ramp.half)) continue;
          const x = ramp.center + ramp.half;
          if (plan.merge && Math.abs(x - plan.endX) < EPS) continue;
          out.push({ branch: plan.id, kind: 'join', position: { x: round(x), y: 0, z: round(-this.options.mainBehind) } });
        } else if (ramp.from === 0 && ramp.to !== 0) {
          if (atKnot(ramp.center - ramp.half)) continue;
          out.push({ branch: plan.id, kind: 'split', position: { x: round(ramp.center - ramp.half), y: 0, z: round(-this.options.mainBehind) } });
        }
      }
      if (plan.merge) out.push({ branch: plan.id, kind: 'merge', position: this.pointOnBranch(plan, plan.endX) });
      if (plan.origin) out.push({ branch: plan.id, kind: 'birth', position: this.pointOnBranch(plan, plan.startX) });
      for (const pause of plan.pauses) {
        out.push({ branch: plan.id, kind: 'fray', position: this.pointOnBranch(plan, pause.gapX) });
        out.push({ branch: plan.id, kind: 'birth', position: this.pointOnBranch(plan, pause.toX) });
      }
    }
    return out.sort((a, b) => a.position.x - b.position.x || a.branch.localeCompare(b.branch));
  }

  /** Composición de la trenza a lo largo de X (según la geometría: una línea cuenta si va por el centro). */
  private braidSpans(plans: readonly BranchPlan[], fromX: number, toX: number): BraidSpan[] {
    const o = this.options;
    const spans: { startX: number; endX: number; members: string[] }[] = [];
    const steps = Math.max(1, Math.ceil((toX - fromX) / o.sampleStep));
    for (let i = 0; i <= steps; i += 1) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const members = plans
        .filter(
          (plan) =>
            x >= plan.startX - EPS && x <= plan.endX + EPS && !this.inGap(plan, x) && this.braidWeight(plan, this.heightAt(plan, x)) >= 0.5,
        )
        .map((plan) => plan.id);
      const last = spans[spans.length - 1];
      if (last && last.members.join('|') === members.join('|')) last.endX = x;
      else {
        if (last) last.endX = x;
        spans.push({ startX: x, endX: x, members });
      }
    }
    return spans.map((span) => ({ startX: round(span.startX), endX: round(span.endX), members: span.members }));
  }

  /**
   * Arco causal por encima (como en un diagrama de arcos): sale del nodo origen, sube tanto más
   * cuanto más pasos salva (acotado) y baja al destino. Un poco por delante en Z.
   */
  private arch(a: Vec3, b: Vec3): Vec3[] {
    const o = this.options;
    const dx = b.x - a.x;
    const height = Math.min(o.linkMaxHeight, o.linkMinHeight + o.linkRise * (dx / o.nodeStep - 1));
    const steps = Math.max(12, Math.ceil(dx / o.sampleStep));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const s = i / steps;
      const bow = Math.sin(Math.PI * s);
      points.push({
        x: round(a.x + dx * s),
        // Sube `height` por encima del extremo más alto (los extremos pueden estar en carriles distintos).
        y: round(a.y + (b.y - a.y) * s + (height + Math.abs(b.y - a.y) / 2) * bow),
        z: round(a.z + (b.z - a.z) * s + 0.3 * bow),
      });
    }
    return points;
  }

  private pointOnBranch(plan: BranchPlan, x: number): Vec3 {
    const y = this.heightAt(plan, x);
    return { x: round(x), y: round(y), z: round(this.depthAt(plan, y)) };
  }

  /** Muestrea la línea: paso regular más los bordes exactos de cada rampa. */
  private sample(plan: BranchPlan, fromX: number, toX: number): Vec3[] {
    const o = this.options;
    const xs = new Set<number>();
    const steps = Math.max(1, Math.ceil((toX - fromX) / o.sampleStep));
    for (let i = 0; i <= steps; i += 1) xs.add(round(fromX + ((toX - fromX) * i) / steps));
    for (const ramp of plan.ramps) {
      for (const x of [ramp.center - ramp.half, ramp.center, ramp.center + ramp.half]) if (x > fromX && x < toX) xs.add(round(x));
    }
    for (const pause of plan.pauses) for (const x of [pause.gapX, pause.toX]) if (x > fromX && x < toX) xs.add(round(x));
    // Los nudos son puntos exactos de la polilínea: todas sus hebras se tocan en el nodo.
    for (const x of plan.knotXs) if (x > fromX && x < toX) xs.add(round(x));
    return [...xs]
      .filter((x) => !this.inGap(plan, x))
      .sort((a, b) => a - b)
      .map((x) => this.pointOnBranch(plan, x));
  }

  /** `true` si X cae dentro del hueco de una pausa (bordes excluidos). */
  private inGap(plan: BranchPlan, x: number): boolean {
    return plan.pauses.some((pause) => x > round(pause.gapX) + EPS && x < round(pause.toX) - EPS);
  }
}
