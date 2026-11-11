import type { LifeEvent } from '../model/LifeEvent';
import type { Timeline } from '../model/Timeline';
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
  /** Banda narrativa: extensión vertical de los nodos (todos en y = 0). */
  readonly band: { readonly minY: number; readonly maxY: number };
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
  /** Retroceso en Z de la línea central para que pase por detrás de los símbolos de la banda. */
  readonly mainBehind: number;
  /** Longitud de la curva que baja del carril a un nodo (o sube), en fracciones de `nodeStep`. */
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
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeStep: 3.6,
  laneMin: 0.42,
  laneMax: 0.78,
  laneDepth: 1.4,
  mainBehind: 0.25,
  ramp: 0.75,
  sampleStep: 0.3,
  padSteps: 1.2,
  nowSteps: 0.8,
  tailSteps: 0.7,
  linkMinHeight: 1.6,
  linkMaxHeight: 6.5,
  linkRise: 0.45,
};

interface BranchPlan {
  readonly id: string;
  readonly main: boolean;
  readonly order: number;
  /** X de los nodos visibles de la línea, en orden. */
  readonly anchors: readonly number[];
  /** Estaciones: puntos en los que la línea toca la banda (origen, nodos, fusión). */
  stations: number[];
  origin: LifeEvent | null;
  merge: { readonly event: LifeEvent; readonly into: string; readonly x: number } | null;
  startX: number;
  endX: number;
  open: boolean;
  lane: number;
  laneY: number;
  laneZ: number;
  /** Si la línea va por la banda antes de su primera estación / después de la última. */
  flatBefore: boolean;
  flatAfter: boolean;
}

/** Coste de mover una rama de su carril madre a otro: distancia en carriles + castigo por cruzar la central. */
const TRUNK_CROSSING_COST = 1.5;
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
 * `nodeStep`, sin escala temporal. Todos viven en la banda (y = 0); cada línea pasa por los suyos y,
 * entre dos nodos suyos separados por otros, viaja por su carril (cerca y tenue) con curvas cortas
 * y monótonas para bajar y subir.
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
    const nowX = ordered.length > 0 ? lastNodeX + o.nowSteps * step : 0;
    const firstX = -o.padSteps * step;
    const endX = nowX + o.padSteps * step * 0.5;
    const yearAtX = this.yearScale(ordered, nowX, timeline.now.toDecimalYear());
    const xAtYear = (year: number): number => this.inverse(ordered, nowX, timeline.now.toDecimalYear(), year);

    const plans = this.planBranches(timeline, ordered, nodeX, isVisible, { firstX, endX, lastNodeX });
    const laneSpacing = this.assignLanes(plans);

    const nodes: LayoutNode[] = ordered.map((event, index) => {
      const x = nodeX.get(event.id) as number;
      const node: LayoutNode = { eventId: event.id, position: { x: round(x), y: 0, z: 0 }, branch: event.branch, index };
      if (!event.isRange) return node;
      const plan = plans.find((item) => item.id === event.branch) as BranchPlan;
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
      };
    });

    const byId = new Map(nodes.map((node) => [node.eventId, node]));
    const links: LayoutLink[] = timeline.causalLinks.flatMap((link) => {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b || b.position.x <= a.position.x) return [];
      return [{ from: link.from, to: link.to, fromBranch: a.branch, toBranch: b.branch, points: this.arch(a.position.x, b.position.x) }];
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
      band: { minY: 0, maxY: 0 },
    };
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

  /** X de un año decimal (inversa de `yearScale`): para el final de los periodos. */
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
    span: { firstX: number; endX: number; lastNodeX: number },
  ): BranchPlan[] {
    const o = this.options;
    const step = o.nodeStep;
    const plans: BranchPlan[] = [];
    timeline.branchIds.forEach((id, order) => {
      const events = ordered.filter((event) => event.branch === id);
      const main = id === timeline.mainBranch;
      if (!main && events.length === 0) return;
      const anchors = events.map((event) => nodeX.get(event.id) as number);
      const line = timeline.getLine(id);
      const first = anchors[0] ?? span.firstX;
      const last = anchors[anchors.length - 1] ?? span.firstX;
      // Origen visible y anterior al primer nodo: la línea sale de él.
      const originEvent = main ? undefined : timeline.originOf(id);
      const origin = isVisible(originEvent) && (nodeX.get(originEvent.id) as number) < first - EPS ? originEvent : null;
      const mergeInfo = main ? undefined : timeline.mergeOf(id);
      const merge =
        mergeInfo && isVisible(mergeInfo.event) && (nodeX.get(mergeInfo.event.id) as number) > last + EPS
          ? { event: mergeInfo.event, into: mergeInfo.branch, x: nodeX.get(mergeInfo.event.id) as number }
          : null;
      const open = !merge && (main || events.some((event) => event.ongoing) || line?.untilPresent === true);
      const stations = [...(origin ? [nodeX.get(origin.id) as number] : []), ...anchors, ...(merge ? [merge.x] : [])];
      const startX = origin ? stations[0] : main ? span.firstX : first - o.padSteps * step * 0.75;
      plans.push({
        id,
        main,
        order,
        anchors,
        stations,
        origin,
        merge,
        startX,
        endX: merge ? merge.x : open ? span.endX : last + o.tailSteps * step,
        open,
        lane: 0,
        laneY: 0,
        laneZ: 0,
        // La central va por la banda antes de su primer nodo y tras el último si ningún otro nodo
        // se interpone (no hay nodos antes / después).
        flatBefore: main && (anchors.length === 0 ? ordered.length === 0 : first <= EPS),
        flatAfter: main && anchors.length > 0 && last >= span.lastNodeX - EPS,
      });
    });
    return plans;
  }

  /**
   * Reparte carriles como un *interval scheduling*: cada línea, por orden de nacimiento, ocupa el
   * carril libre más cercano al de su madre (los de líneas ya cerradas se reutilizan), evitando
   * cruzar la central. La central ocupa el primer carril de abajo. Las alturas se reparten en
   * `[laneMin, laneMax] × nodeStep`: amplitud pequeña y constante. Devuelve la separación usada.
   */
  private assignLanes(plans: BranchPlan[]): number {
    const o = this.options;
    const step = o.nodeStep;
    const gap = step * 0.5;
    const occupiedUntil = new Map<number, number>();
    const laneOf = new Map<string, number>(plans.filter((plan) => plan.main).map((plan) => [plan.id, 0]));
    const side = plans.filter((plan) => !plan.main).sort((a, b) => a.startX - b.startX || a.order - b.order);
    const isFree = (lane: number, x: number): boolean => (occupiedUntil.get(lane) ?? -Infinity) + gap <= x;
    for (const plan of side) {
      const parent = plan.origin ? (laneOf.get(plan.origin.branch) ?? 0) : 0;
      let up = 0;
      let down = 0;
      for (const [lane, until] of occupiedUntil) {
        if (until + gap <= plan.startX) continue;
        if (lane > 0) up += 1;
        else down += 1;
      }
      // La central ya ocupa un carril de abajo: a igualdad, arriba.
      const preferUp = up <= down + 1;
      const mergeLane = plan.merge ? laneOf.get(plan.merge.into) : undefined;
      const cost = (lane: number): number =>
        Math.abs(lane - parent) +
        (parent !== 0 && Math.sign(lane) !== Math.sign(parent) ? TRUNK_CROSSING_COST : 0) +
        (mergeLane === undefined || mergeLane === 0
          ? 0
          : Math.abs(lane - mergeLane) + (Math.sign(lane) !== Math.sign(mergeLane) ? TRUNK_CROSSING_COST : 0));
      let best = 0;
      for (let n = 1; n <= MAX_LANE; n += 1) {
        for (const lane of preferUp ? [n, -n] : [-n, n]) {
          if (!isFree(lane, plan.startX)) continue;
          if (best === 0 || cost(lane) < cost(best) || (cost(lane) === cost(best) && Math.abs(lane) < Math.abs(best))) best = lane;
        }
        if (best !== 0 && n - Math.abs(parent) > cost(best) && (mergeLane === undefined || n - Math.abs(mergeLane) > cost(best))) break;
      }
      plan.lane = best;
      laneOf.set(plan.id, best);
      occupiedUntil.set(best, plan.endX);
    }

    // Niveles: arriba, el carril; abajo, la central es el nivel 1 y las demás bajan uno.
    const levelOf = (plan: BranchPlan): number => (plan.main ? 1 : plan.lane > 0 ? plan.lane : -plan.lane + 1);
    const maxLevel = Math.max(1, ...plans.map(levelOf));
    const spacing = maxLevel > 1 ? ((o.laneMax - o.laneMin) * step) / (maxLevel - 1) : 0;
    for (const plan of plans) {
      const level = levelOf(plan);
      const sign = plan.main || plan.lane < 0 ? -1 : 1;
      plan.laneY = sign * (o.laneMin * step + spacing * (level - 1));
      plan.laneZ = -o.laneDepth * (level / maxLevel);
    }
    return spacing;
  }

  /**
   * Arco causal por encima de la banda (como en un diagrama de arcos): sale del nodo origen, sube
   * tanto más cuanto más pasos salva (acotado) y baja al destino. Un poco por delante en Z.
   */
  private arch(ax: number, bx: number): Vec3[] {
    const o = this.options;
    const dx = bx - ax;
    const height = Math.min(o.linkMaxHeight, o.linkMinHeight + o.linkRise * (dx / o.nodeStep - 1));
    const steps = Math.max(12, Math.ceil(dx / o.sampleStep));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const s = i / steps;
      const bow = Math.sin(Math.PI * s);
      points.push({ x: round(ax + dx * s), y: round(height * bow), z: round(0.3 * bow) });
    }
    return points;
  }

  /**
   * Punto de la línea en X. Entre dos estaciones contiguas (sin nodos por medio) va recta por la
   * banda; si hay nodos de otras líneas entre ellas, sube a su carril con una curva corta (`ramp`),
   * lo recorre recto y vuelve a bajar. Antes de la primera y tras la última, va por su carril.
   */
  private pointOnBranch(plan: BranchPlan, x: number): Vec3 {
    const o = this.options;
    const ramp = o.ramp * o.nodeStep;
    const stations = plan.stations;
    // La central es la columna vertebral: va siempre recta por la banda y pasa por detrás de los
    // nodos de otras líneas en lugar de esquivarlos (sin "dientes de sierra").
    if (plan.main) return { x: round(x), y: 0, z: round(-o.mainBehind) };
    let out: number;
    if (stations.length === 0) out = plan.flatBefore ? 0 : 1;
    else if (x <= stations[0]) out = plan.flatBefore ? 0 : smoothstep((stations[0] - x) / ramp);
    else if (x >= stations[stations.length - 1]) out = plan.flatAfter ? 0 : smoothstep((x - stations[stations.length - 1]) / ramp);
    else {
      let lo = 0;
      let hi = stations.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (stations[mid] <= x) lo = mid;
        else hi = mid;
      }
      const a = stations[lo];
      const b = stations[hi];
      if (b - a <= o.nodeStep * 1.01) out = 0;
      else {
        const r = Math.min(ramp, (b - a) / 2);
        out = Math.min(smoothstep((x - a) / r), smoothstep((b - x) / r));
      }
    }
    return { x: round(x), y: round(plan.laneY * out), z: round(plan.laneZ * out) };
  }

  /** Muestrea la línea: paso regular más los bordes exactos de cada curva (estaciones y rampas). */
  private sample(plan: BranchPlan, fromX: number, toX: number): Vec3[] {
    const o = this.options;
    const ramp = o.ramp * o.nodeStep;
    const xs = new Set<number>();
    const steps = Math.max(1, Math.ceil((toX - fromX) / o.sampleStep));
    for (let i = 0; i <= steps; i += 1) xs.add(round(fromX + ((toX - fromX) * i) / steps));
    for (const s of plan.stations) for (const x of [s, s - ramp, s + ramp]) if (x > fromX && x < toX) xs.add(round(x));
    return [...xs].sort((a, b) => a - b).map((x) => this.pointOnBranch(plan, x));
  }
}
