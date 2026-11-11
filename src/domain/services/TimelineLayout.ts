import { arcEndYear, arcStartYear } from '../model/LifeArc';
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

/** Enlace causal («esto llevó a esto»): hebra de tinta del nodo origen al nodo destino. */
export interface LayoutLink {
  readonly from: string;
  readonly to: string;
  /** Línea del origen y del destino (la hebra mezcla sus colores). */
  readonly fromBranch: string;
  readonly toBranch: string;
  /** Polilínea de la hebra, del origen al destino. */
  readonly points: readonly Vec3[];
}

/** Capítulo proyectado sobre el eje X. */
export interface LayoutArc {
  readonly id: string;
  readonly startX: number;
  readonly endX: number;
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
  /** Arcos temporales (capítulos) en X, en orden. */
  readonly arcs: readonly LayoutArc[];
  /** Enlaces causales entre eventos visibles. */
  readonly links: readonly LayoutLink[];
  /** Banda narrativa: extensión vertical de los nodos (todos viven cerca de y = 0). */
  readonly band: { readonly minY: number; readonly maxY: number };
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
  /** Años que tarda en abrirse una línea con `origin` declarado (haz desde el nacimiento). */
  readonly bundleBlendYears: number;
  /** Años que dura la curva de convergencia de una línea que se fusiona. */
  readonly mergeBlendYears: number;
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
  /** Media altura de la banda narrativa donde viven los nodos. */
  readonly bandHalfHeight: number;
  /** Desfase vertical de los nodos por carril dentro de la banda. */
  readonly bandLaneStep: number;
  /** Separación vertical mínima entre nodos que coinciden en fecha (se apilan). */
  readonly stackGap: number;
  /** Distancia en X por debajo de la cual dos nodos «coinciden» y se apilan. */
  readonly stackDx: number;
  /** Distancia en X que tarda una línea en salir de la banda (o volver a ella) junto a un nodo. */
  readonly pinchX: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  unitsPerYear: 5,
  laneSpacing: 3.6,
  minLaneSpacing: 1.7,
  maxLaneSpread: 7.5,
  laneDepth: 2.4,
  blendYears: 1.1,
  bundleBlendYears: 2.6,
  mergeBlendYears: 2.2,
  sampleStep: 0.5,
  padYears: 1.2,
  tailYears: 0.9,
  minNodeGap: 1.7,
  waveAmplitude: 0.7,
  bandHalfHeight: 1.5,
  bandLaneStep: 0.42,
  stackGap: 1.25,
  stackDx: 1.4,
  pinchX: 3.2,
};

interface Anchor {
  readonly x: number;
  readonly y: number;
}

interface BranchPlan {
  readonly id: string;
  readonly main: boolean;
  readonly order: number;
  readonly events: LifeEvent[];
  readonly origin: LifeEvent | null;
  /** Unidades de X que tarda en alcanzar su carril. */
  readonly blendX: number;
  merge: { readonly target: BranchPlan; readonly event: LifeEvent; readonly x: number; readonly blendX: number } | null;
  startX: number;
  endX: number;
  open: boolean;
  lane: number;
  laneY: number;
  laneZ: number;
  originPosition: Vec3;
  /** Nodos de la línea dentro de la banda, ordenados por X: la línea pasa por cada uno. */
  anchors: Anchor[];
}

/** Coste de mover una rama de su carril madre a otro: distancia en carriles + castigo por cruzar el tronco. */
const TRUNK_CROSSING_COST = 1.5;
const MAX_LANE = 64;

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const round = (value: number): number => Math.round(value * 1000) / 1000 || 0;

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
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    this.planMerges(timeline, plans, planById, nodeX);
    const laneSpacing = this.assignLanes(plans);
    const nodeY = this.assignBand(timeline, plans, planById, nodeX);

    const resolved = new Set<string>();
    const positionOn = (plan: BranchPlan, x: number): Vec3 => this.pointOnBranch(plan, x);
    const resolveOrigin = (plan: BranchPlan): void => {
      if (resolved.has(plan.id)) return;
      resolved.add(plan.id);
      if (plan.merge) resolveOrigin(plan.merge.target);
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

    const branches: LayoutBranch[] = plans.map((plan) => {
      const points = this.sample(plan, plan.startX, plan.endX);
      const line = timeline.getLine(plan.id);
      return {
        id: plan.id,
        points,
        originEventId: plan.origin?.id ?? null,
        lane: plan.lane,
        open: plan.open,
        main: plan.main,
        focus: points.map((point) => focusIntensityAt(line, originYear + point.x / o.unitsPerYear)),
        merge: plan.merge ? { into: plan.merge.target.id, eventId: plan.merge.event.id, position: points[points.length - 1] } : null,
      };
    });

    const nodePosition = new Map(nodes.map((node) => [node.eventId, node]));
    const links: LayoutLink[] = timeline.causalLinks.flatMap((link, index) => {
      const a = nodePosition.get(link.from);
      const b = nodePosition.get(link.to);
      if (!a || !b) return [];
      return [{ from: link.from, to: link.to, fromBranch: a.branch, toBranch: b.branch, points: this.strand(a.position, b.position, index) }];
    });
    const ys = [...nodeY.values()];

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
    const arcs: LayoutArc[] = timeline.arcs.map((arc) => {
      const end = arcEndYear(arc);
      return {
        id: arc.id,
        startX: round(toX(arcStartYear(arc))),
        endX: round(Number.isFinite(end) ? Math.min(toX(end), Math.max(lastX, maxX)) : Math.max(lastX, maxX)),
      };
    });
    return {
      nodes,
      branches,
      years,
      bounds: { minX, maxX, minY, maxY },
      nowX: round(nowX),
      laneSpacing: round(laneSpacing),
      arcs,
      links,
      band: { minY: ys.length ? Math.min(...ys) : 0, maxY: ys.length ? Math.max(...ys) : 0 },
    };
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
    timeline.branchIds.forEach((id, order) => {
      const events = timeline.eventsOfBranch(id);
      const base = { id, order, events, merge: null, lane: 0, laneY: 0, laneZ: 0, anchors: [] };
      if (id === timeline.mainBranch) {
        plans.push({
          ...base,
          main: true,
          origin: null,
          blendX: o.blendYears * o.unitsPerYear,
          startX: firstX - pad,
          endX: lastX + pad * 0.5,
          open: true,
          originPosition: { x: firstX - pad, y: 0, z: 0 },
        });
        return;
      }
      const line = timeline.getLine(id);
      // Si el origen no existe (p. ej. es privado y está oculto) la rama nace del tronco.
      const origin = timeline.originOf(id) ?? null;
      // Las líneas con `origin` declarado se abren despacio, como un haz desde su nacimiento.
      const bundle = origin !== null && line?.originEventId === origin.id;
      const xs = events.map((event) => nodeX.get(event.id) as number);
      const firstNodeX = Math.min(...xs);
      const startX = origin
        ? Math.min(nodeX.get(origin.id) as number, firstNodeX - 0.5 * o.unitsPerYear)
        : firstNodeX - o.blendYears * o.unitsPerYear;
      const open = events.some((event) => event.ongoing) || line?.untilPresent === true;
      const lastNodeX = Math.max(...xs);
      const lastEndX = Math.max(
        lastNodeX,
        ...events.map((event) => (event.end ? toX(event.end.toDecimalYear()) : -Infinity)),
      );
      plans.push({
        ...base,
        main: false,
        origin,
        blendX: (bundle ? o.bundleBlendYears : o.blendYears) * o.unitsPerYear,
        startX,
        endX: open ? lastX + pad * 0.5 : lastEndX + o.tailYears * o.unitsPerYear,
        open,
        originPosition: { x: startX, y: 0, z: 0 },
      });
    });
    return plans;
  }

  /** Líneas que convergen en otra: terminan en la X del evento de fusión, sin cola ni «hoy». */
  private planMerges(
    timeline: Timeline,
    plans: readonly BranchPlan[],
    planById: ReadonlyMap<string, BranchPlan>,
    nodeX: ReadonlyMap<string, number>,
  ): void {
    for (const plan of plans) {
      if (plan.main) continue;
      const merge = timeline.mergeOf(plan.id);
      const target = merge ? planById.get(merge.branch) : undefined;
      if (!merge || !target) continue;
      const x = nodeX.get(merge.event.id) as number;
      // Una fusión anterior al nacimiento de la línea no tiene sentido geométrico: se ignora.
      if (x <= plan.startX + this.options.sampleStep) continue;
      const blendX = Math.min(this.options.mergeBlendYears * this.options.unitsPerYear, (x - plan.startX) * 0.6);
      plan.merge = { target, event: merge.event, x, blendX };
      plan.endX = x;
      plan.open = false;
    }
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
    const laneOf = new Map<string, number>(plans.filter((plan) => plan.main).map((plan) => [plan.id, 0]));
    const side = plans.filter((plan) => !plan.main).sort((a, b) => a.startX - b.startX || a.order - b.order);
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
      // Si converge en una línea que ya tiene carril, conviene quedar cerca de ella (y de su lado).
      const mergeLane = plan.merge ? laneOf.get(plan.merge.target.id) : undefined;
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
          const better =
            best === 0 ||
            cost(lane) < cost(best) ||
            // Mismo coste: el más cercano al tronco (y, a igual distancia, el del lado preferido,
            // que es el primero que se prueba).
            (cost(lane) === cost(best) && Math.abs(lane) < Math.abs(best));
          if (better) best = lane;
        }
        // Ningún carril más lejano puede mejorar al encontrado.
        if (best !== 0 && n - Math.abs(parent) > cost(best) && (mergeLane === undefined || n - Math.abs(mergeLane) > cost(best))) break;
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

  /**
   * Banda narrativa: cada nodo vive cerca de y = 0 con un ligero desfase por carril (arriba los
   * carriles positivos, abajo los negativos). Si dos nodos coinciden en fecha, el segundo se apila
   * en el hueco libre más cercano (separación `stackGap`). Rellena `plan.anchors`.
   */
  private assignBand(
    timeline: Timeline,
    plans: readonly BranchPlan[],
    planById: ReadonlyMap<string, BranchPlan>,
    nodeX: ReadonlyMap<string, number>,
  ): Map<string, number> {
    const o = this.options;
    const items = timeline.events
      .map((event) => ({ event, x: nodeX.get(event.id) as number, plan: planById.get(event.branch) as BranchPlan }))
      .sort((a, b) => a.x - b.x || a.plan.order - b.plan.order || a.event.id.localeCompare(b.event.id));
    const placed: { x: number; y: number }[] = [];
    const result = new Map<string, number>();
    for (const item of items) {
      const base = Math.max(-o.bandHalfHeight, Math.min(o.bandHalfHeight, item.plan.lane * o.bandLaneStep));
      const near = placed.filter((other) => Math.abs(other.x - item.x) < o.stackDx);
      const free = (y: number): boolean => near.every((other) => Math.abs(other.y - y) >= o.stackGap - 1e-9);
      let y = base;
      // Alterna arriba/abajo empezando por el lado del carril.
      const side = item.plan.lane < 0 ? -1 : 1;
      for (let k = 1; !free(y) && k < 64; k += 1) {
        const step = Math.ceil(k / 2) * o.stackGap;
        y = base + (k % 2 === 1 ? side : -side) * step;
      }
      y = round(y);
      placed.push({ x: item.x, y });
      result.set(item.event.id, y);
    }
    for (const plan of plans) {
      plan.anchors = plan.events
        .map((event) => ({ x: nodeX.get(event.id) as number, y: result.get(event.id) as number }))
        .sort((a, b) => a.x - b.x);
    }
    return result;
  }

  /** Hebra causal: arco suave del nodo origen al destino, un poco por delante de las líneas. */
  private strand(a: Vec3, b: Vec3, index: number): Vec3[] {
    const dx = b.x - a.x;
    const length = Math.hypot(dx, b.y - a.y);
    const steps = Math.max(10, Math.ceil(length / this.options.sampleStep));
    const arch = (index % 2 === 0 ? 1 : -1) * Math.min(2.4, 0.7 + 0.05 * Math.abs(dx));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const s = i / steps;
      const bow = Math.sin(Math.PI * s);
      points.push({
        x: round(a.x + dx * s),
        y: round(a.y + (b.y - a.y) * smoothstep(s) + arch * bow),
        z: round(a.z + (b.z - a.z) * s + 0.8 * bow),
      });
    }
    return points;
  }

  /**
   * Punto de la línea en X: la curva de su carril, atraída hacia la banda junto a cada uno de sus
   * nodos. Entre dos nodos la línea sale de la banda (tanto más cuanto más separados estén) y vuelve
   * para pasar exactamente por el siguiente.
   */
  private pointOnBranch(plan: BranchPlan, x: number): Vec3 {
    const lane = this.pointOnLane(plan, x);
    const anchors = plan.anchors;
    if (anchors.length === 0) return lane;
    const pinch = this.options.pinchX;
    let bandY: number;
    let bandZ = 0;
    let out: number;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (x <= first.x) {
      if (plan.main) {
        out = smoothstep((first.x - x) / pinch);
        bandY = first.y;
      } else {
        // Antes del primer nodo: del nacimiento (origen) al nodo, saliendo de la banda entre medias.
        const from = plan.originPosition;
        const t = (x - plan.startX) / Math.max(1e-6, first.x - plan.startX);
        bandY = from.y + (first.y - from.y) * smoothstep(t);
        bandZ = from.z * (1 - smoothstep(t));
        out = smoothstep((x - plan.startX) / pinch) * smoothstep((first.x - x) / pinch);
      }
    } else if (x >= last.x) {
      out = smoothstep((x - last.x) / pinch);
      bandY = last.y;
      if (plan.merge) {
        // Fusión: vuelve a la banda en el nodo de destino.
        out *= smoothstep((plan.endX - x) / pinch);
        const k = smoothstep((x - last.x) / Math.max(1e-6, plan.endX - last.x));
        bandY = last.y + (lane.y - last.y) * k;
        bandZ = lane.z * k;
      }
    } else {
      let lo = 0;
      let hi = anchors.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid].x <= x) lo = mid;
        else hi = mid;
      }
      const a = anchors[lo];
      const b = anchors[hi];
      const t = (x - a.x) / Math.max(1e-6, b.x - a.x);
      bandY = a.y + (b.y - a.y) * smoothstep(t);
      out = smoothstep((x - a.x) / pinch) * smoothstep((b.x - x) / pinch);
    }
    return { x: lane.x, y: round(bandY + (lane.y - bandY) * out), z: round(bandZ + (lane.z - bandZ) * out) };
  }

  private pointOnLane(plan: BranchPlan, x: number): Vec3 {
    const o = this.options;
    const { laneY, laneZ } = plan;
    const waveY = o.waveAmplitude * Math.sin(x * 0.13 + plan.lane * 1.7);
    const waveZ = o.waveAmplitude * 0.8 * Math.cos(x * 0.09 + plan.lane * 0.9);
    if (plan.main) return { x: round(x), y: round(waveY), z: round(waveZ) };
    const blend = smoothstep((x - plan.startX) / plan.blendX);
    const from = plan.originPosition;
    let y = from.y + (laneY + waveY - from.y) * blend;
    let z = from.z + (laneZ + waveZ - from.z) * blend;
    if (plan.merge) {
      // Convergencia: en los últimos `blendX` la línea se curva hasta coincidir con la de destino.
      const k = smoothstep((x - (plan.merge.x - plan.merge.blendX)) / plan.merge.blendX);
      if (k > 0) {
        const to = this.pointOnBranch(plan.merge.target, x);
        y += (to.y - y) * k;
        z += (to.z - z) * k;
      }
    }
    return { x: round(x), y: round(y), z: round(z) };
  }

  private sample(plan: BranchPlan, fromX: number, toX: number): Vec3[] {
    const steps = Math.max(1, Math.ceil((toX - fromX) / this.options.sampleStep));
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i += 1) points.push(this.pointOnBranch(plan, fromX + ((toX - fromX) * i) / steps));
    return points;
  }
}
