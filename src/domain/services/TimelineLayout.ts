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
  /** Separación vertical efectiva entre carriles (puede ser menor que `laneSpacing`). */
  readonly laneSpacing: number;
}

export interface LayoutOptions {
  /** Unidades de mundo por año (eje X = tiempo). */
  readonly unitsPerYear: number;
  /** Separación vertical entre carriles (la máxima; se comprime si hay muchos carriles). */
  readonly laneSpacing: number;
  /** Separación vertical mínima: la compresión nunca baja de aquí. */
  readonly minLaneSpacing: number;
  /** Altura objetivo (por encima o por debajo del tronco) del carril más alejado. */
  readonly maxLaneSpread: number;
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
  minLaneSpacing: 2.6,
  maxLaneSpread: 10,
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
  laneY: number;
  laneZ: number;
  originPosition: Vec3;
}

/** Coste de mover una rama de su carril madre a otro: distancia en carriles + castigo por cruzar el tronco. */
const TRUNK_CROSSING_COST = 1.5;
const MAX_LANE = 64;

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
    const laneSpacing = this.assignLanes(plans);

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
      // Normalmente startX es la X del evento de origen y la rama sale de su nodo. Si la rama tiene
      // eventos anteriores a su origen, empieza antes: entonces se separa de la línea madre a esa
      // altura (en la misma X), en vez de nacer «flotando» con la Y/Z del nodo de origen.
      plan.originPosition = positionOn(parent, Math.min(nodeX.get(plan.origin.id) ?? plan.startX, plan.startX));
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
    return { nodes, branches, years, bounds: { minX, maxX, minY, maxY }, nowX: round(nowX), laneSpacing: round(laneSpacing) };
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
          laneY: 0,
          laneZ: 0,
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
        laneY: 0,
        laneZ: 0,
        originPosition: { x: startX, y: 0, z: 0 },
      });
    }
    return plans;
  }

  /**
   * Reparte carriles como un *interval scheduling*: cada rama, por orden de nacimiento, ocupa el
   * carril libre más cercano al de su rama madre (los carriles de ramas ya cerradas se reutilizan),
   * evitando cruzar el tronco. Así el nº de carriles depende de cuántas ramas conviven a la vez, no
   * del total. Después la separación vertical se comprime para que el carril más alejado no pase
   * de `maxLaneSpread` (sin bajar de `minLaneSpacing`). Devuelve la separación usada.
   */
  private assignLanes(plans: BranchPlan[]): number {
    const o = this.options;
    const gap = o.unitsPerYear * 0.8;
    const occupiedUntil = new Map<number, number>();
    const laneOf = new Map<string, number>([[MAIN_BRANCH, 0]]);
    const side = plans
      .filter((plan) => plan.id !== MAIN_BRANCH)
      .sort((a, b) => a.startX - b.startX || a.id.localeCompare(b.id));
    const isFree = (lane: number, x: number): boolean => (occupiedUntil.get(lane) ?? -Infinity) + gap <= x;
    for (const plan of side) {
      const parent = plan.origin ? (laneOf.get(plan.origin.branch) ?? 0) : 0;
      // Lado con menos carriles ocupados ahora mismo: desempata las ramas que salen del tronco.
      let up = 0;
      let down = 0;
      for (const [lane, until] of occupiedUntil) {
        if (until + gap <= plan.startX) continue;
        if (lane > 0) up += 1;
        else down += 1;
      }
      const preferUp = up <= down;
      const cost = (lane: number): number =>
        Math.abs(lane - parent) + (parent !== 0 && Math.sign(lane) !== Math.sign(parent) ? TRUNK_CROSSING_COST : 0);
      let best = 0;
      for (let n = 1; n <= MAX_LANE; n += 1) {
        for (const lane of preferUp ? [n, -n] : [-n, n]) {
          if (!isFree(lane, plan.startX)) continue;
          const better =
            best === 0 ||
            cost(lane) < cost(best) ||
            // Mismo coste: el más cercano al tronco (y, a igual distancia, el del lado preferido,
            // que es el primero que se prueba).
            (cost(lane) === cost(best) && Math.abs(lane) < Math.abs(best));
          if (better) best = lane;
        }
        // Ningún carril más lejano puede mejorar al encontrado.
        if (best !== 0 && n - Math.abs(parent) > cost(best)) break;
      }
      plan.lane = best;
      laneOf.set(plan.id, best);
      occupiedUntil.set(best, plan.endX);
    }

    const reach = Math.max(1, ...side.map((plan) => Math.abs(plan.lane)));
    const spacing = Math.min(o.laneSpacing, Math.max(o.minLaneSpacing, o.maxLaneSpread / reach));
    const depth = o.laneDepth * (spacing / o.laneSpacing);
    for (const plan of side) {
      plan.laneY = plan.lane * spacing;
      plan.laneZ = -Math.abs(plan.lane) * depth;
    }
    return spacing;
  }

  private pointOnBranch(plan: BranchPlan, x: number): Vec3 {
    const o = this.options;
    const { laneY, laneZ } = plan;
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
