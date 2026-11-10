import { MAIN_BRANCH, type LifeEvent } from '../model/LifeEvent';
import type { Timeline } from '../model/Timeline';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LayoutNode {
  readonly eventId: string;
  readonly position: Vec3;
  readonly branch: string;
  /** Para eventos con duración: puntos sobre la rama desde el inicio hasta el fin (o "hoy"). */
  readonly span?: readonly Vec3[];
}

export interface LayoutBranch {
  readonly id: string;
  /** Polilínea muestreada de la rama, en orden creciente de X. */
  readonly points: readonly Vec3[];
  /** Evento del que nace (bifurcación); `null` para el tronco. */
  readonly originEventId: string | null;
  /** Carril: 0 = tronco; positivos hacia arriba, negativos hacia abajo. */
  readonly lane: number;
  /** `true` si la rama sigue viva hoy (no se desvanece al final). */
  readonly open: boolean;
}

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
  /** X correspondiente a "hoy". */
  readonly nowX: number;
}

export interface LayoutOptions {
  /** Unidades de mundo por año (eje X = tiempo). */
  readonly unitsPerYear: number;
  /** Separación vertical entre carriles. */
  readonly laneSpacing: number;
  /** Retroceso en Z por carril. */
  readonly laneDepth: number;
  /** Años que tarda una rama en alcanzar su carril tras bifurcarse. */
  readonly blendYears: number;
  /** Distancia en X entre muestras de la polilínea. */
  readonly sampleStep: number;
  /** Años de margen antes del primer evento y después de "hoy". */
  readonly padYears: number;
  /** Años que se prolonga (desvaneciéndose) una rama cerrada tras su último evento. */
  readonly tailYears: number;
  /** Separación mínima en X entre nodos consecutivos de una misma rama. */
  readonly minNodeGap: number;
  /** Amplitud de la ondulación orgánica de las ramas. */
  readonly waveAmplitude: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  unitsPerYear: 5,
  laneSpacing: 4.6,
  laneDepth: 2.4,
  blendYears: 1.1,
  sampleStep: 0.5,
  padYears: 1.2,
  tailYears: 0.9,
  minNodeGap: 1.7,
  waveAmplitude: 0.45,
};

interface BranchPlan {
  readonly id: string;
  readonly events: LifeEvent[];
  readonly origin: LifeEvent | null;
  startX: number;
  endX: number;
  open: boolean;
  lane: number;
  originPosition: Vec3;
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Posiciona nodos y ramas. Puro y determinista: mismo `Timeline` → mismo resultado.
 * El eje X es el tiempo; cada rama se desvía en Y/Z desde el evento `branchFrom`.
 */
export class TimelineLayout {
  private readonly options: LayoutOptions;

  constructor(options: Partial<LayoutOptions> = {}) {
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  }

  compute(timeline: Timeline): TimelineLayoutResult {
    const o = this.options;
    const range = timeline.yearRange;
    const originYear = Math.floor(range.start);
    const toX = (decimalYear: number): number => (decimalYear - originYear) * o.unitsPerYear;
    const nowX = toX(timeline.now.toDecimalYear());
    const lastX = Math.max(nowX, toX(range.end));

    const nodeX = this.assignNodeX(timeline, toX);
    const plans = this.planBranches(timeline, nodeX, toX, toX(range.start), lastX);
    this.assignLanes(plans);

    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const resolved = new Set<string>();
    const positionOn = (plan: BranchPlan, x: number): Vec3 => this.pointOnBranch(plan, x);
    const resolveOrigin = (plan: BranchPlan): void => {
      if (resolved.has(plan.id)) return;
      resolved.add(plan.id);
      if (!plan.origin) return;
      const parent = planById.get(plan.origin.branch);
      if (!parent || parent === plan) return;
      resolveOrigin(parent);
      plan.originPosition = positionOn(parent, nodeX.get(plan.origin.id) ?? plan.startX);
    };
    plans.forEach(resolveOrigin);

    const nodes: LayoutNode[] = timeline.events.map((event) => {
      const plan = planById.get(event.branch) as BranchPlan;
      const x = nodeX.get(event.id) as number;
      const node: LayoutNode = { eventId: event.id, position: positionOn(plan, x), branch: event.branch };
      if (!event.isRange) return node;
      const endX = event.ongoing ? nowX : toX((event.end ?? event.start).toDecimalYear());
      if (endX - x < o.sampleStep) return node;
      return { ...node, span: this.sample(plan, x, Math.min(endX, plan.endX)) };
    });

    const branches: LayoutBranch[] = plans.map((plan) => ({
      id: plan.id,
      points: this.sample(plan, plan.startX, plan.endX),
      originEventId: plan.origin?.id ?? null,
      lane: plan.lane,
      open: plan.open,
    }));

    const years: YearMark[] = [];
    const firstYear = Math.ceil(originYear + plans[0].startX / o.unitsPerYear);
    // No se rotulan años que aún no han empezado.
    const lastYear = Math.floor(originYear + lastX / o.unitsPerYear);
    for (let year = firstYear; year <= lastYear; year += 1) years.push({ year, x: toX(year) });

    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const branch of branches) {
      for (const point of branch.points) {
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
      }
    }
    return { nodes, branches, years, bounds: { minX, maxX, minY, maxY }, nowX: round(nowX) };
  }

  /** X de cada nodo, separando los que caerían demasiado juntos en la misma rama. */
  private assignNodeX(timeline: Timeline, toX: (year: number) => number): Map<string, number> {
    const result = new Map<string, number>();
    for (const branchId of timeline.branchIds) {
      let previous = -Infinity;
      for (const event of timeline.eventsOfBranch(branchId)) {
        const x = Math.max(toX(event.start.toDecimalYear()), previous + this.options.minNodeGap);
        result.set(event.id, x);
        previous = x;
      }
    }
    return result;
  }

  private planBranches(
    timeline: Timeline,
    nodeX: Map<string, number>,
    toX: (year: number) => number,
    firstX: number,
    lastX: number,
  ): BranchPlan[] {
    const o = this.options;
    const pad = o.padYears * o.unitsPerYear;
    const plans: BranchPlan[] = [];
    for (const id of timeline.branchIds) {
      const events = timeline.eventsOfBranch(id);
      if (id === MAIN_BRANCH) {
        plans.push({
          id,
          events,
          origin: null,
          startX: firstX - pad,
          endX: lastX + pad * 0.5,
          open: true,
          lane: 0,
          originPosition: { x: firstX - pad, y: 0, z: 0 },
        });
        continue;
      }
      const originId = events.find((event) => event.branchFrom !== undefined)?.branchFrom;
      const originEvent = originId === undefined ? undefined : timeline.getEvent(originId);
      // Si el origen no existe (p. ej. es privado y está oculto) la rama nace del tronco.
      const origin = originEvent && originEvent.branch !== id ? originEvent : null;
      const xs = events.map((event) => nodeX.get(event.id) as number);
      const firstNodeX = Math.min(...xs);
      const startX = origin
        ? Math.min(nodeX.get(origin.id) as number, firstNodeX - 0.5 * o.unitsPerYear)
        : firstNodeX - o.blendYears * o.unitsPerYear;
      const open = events.some((event) => event.ongoing);
      const lastNodeX = Math.max(...xs);
      const lastEndX = Math.max(
        lastNodeX,
        ...events.map((event) => (event.end ? toX(event.end.toDecimalYear()) : -Infinity)),
      );
      plans.push({
        id,
        events,
        origin,
        startX,
        endX: open ? lastX + pad * 0.5 : lastEndX + o.tailYears * o.unitsPerYear,
        open,
        lane: 0,
        originPosition: { x: startX, y: 0, z: 0 },
      });
    }
    return plans;
  }

  /** Reparte carriles (+1, −1, +2, −2…) reutilizando los que ya han quedado libres. */
  private assignLanes(plans: BranchPlan[]): void {
    const gap = this.options.unitsPerYear * 0.8;
    const occupiedUntil = new Map<number, number>();
    const side = plans
      .filter((plan) => plan.id !== MAIN_BRANCH)
      .sort((a, b) => a.startX - b.startX || a.id.localeCompare(b.id));
    for (const plan of side) {
      for (let n = 1; ; n += 1) {
        const lane = n % 2 === 1 ? (n + 1) / 2 : -n / 2;
        if ((occupiedUntil.get(lane) ?? -Infinity) + gap <= plan.startX) {
          plan.lane = lane;
          occupiedUntil.set(lane, plan.endX);
          break;
        }
      }
    }
  }

  private pointOnBranch(plan: BranchPlan, x: number): Vec3 {
    const o = this.options;
    const laneY = plan.lane * o.laneSpacing;
    const laneZ = -Math.abs(plan.lane) * o.laneDepth;
    const waveY = o.waveAmplitude * Math.sin(x * 0.13 + plan.lane * 1.7);
    const waveZ = o.waveAmplitude * 0.8 * Math.cos(x * 0.09 + plan.lane * 0.9);
    if (plan.id === MAIN_BRANCH) return { x: round(x), y: round(waveY), z: round(waveZ) };
    const blend = smoothstep((x - plan.startX) / (o.blendYears * o.unitsPerYear));
    const from = plan.originPosition;
    return {
      x: round(x),
      y: round(from.y + (laneY + waveY - from.y) * blend),
      z: round(from.z + (laneZ + waveZ - from.z) * blend),
    };
  }

  private sample(plan: BranchPlan, fromX: number, toX: number): Vec3[] {
    const steps = Math.max(1, Math.ceil((toX - fromX) / this.options.sampleStep));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i += 1) points.push(this.pointOnBranch(plan, fromX + ((toX - fromX) * i) / steps));
    return points;
  }
}
