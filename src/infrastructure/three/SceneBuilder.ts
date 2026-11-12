import type { TimelineViewModel } from '../../application/ports';
import { branchPieces } from '../../domain/services';
import { ActiveTip } from './ActiveTip';
import { ArcBands } from './ArcBands';
import { BranchCurve, type BranchStyle } from './BranchCurve';
import { sampleAlongPath } from './math';
import { MergeSeam } from './MergeSeam';
import { NodeAssets, NodeMesh } from './NodeMesh';
import { ParticleFlow, type FlowPath } from './ParticleFlow';
import type { SceneEffect } from './SceneEffect';
import { SelectionPulse } from './SelectionPulse';
import { createRingTexture } from './textures';
import { DEFAULT_WATERCOLOR, WatercolorWash } from './Watercolor';
import { YearMarkers } from './YearMarkers';

export interface ScenePalette {
  /** Papel: índigo/ciruela muy oscuro (no negro), también color de la niebla. */
  readonly background: string;
  /** Color de una línea que no declara color ni tiene categoría de la que tomarlo. */
  readonly trunk: string;
}

export const DEFAULT_PALETTE: ScenePalette = {
  background: DEFAULT_WATERCOLOR.paper,
  trunk: '#a9d4ff',
};


/**
 * La trenza: grosor, brillo y hélice. `outer` y `outerWidth` son el brillo y el grosor relativos de
 * una línea en su carril exterior (fuera de foco: fina y tenue).
 */
export const BRAID_STYLE = {
  radius: 0.085,
  intensity: 0.95,
  outer: 0.3,
  outerWidth: 0.5,
  helix: 0.16,
  frequency: 0.55,
  speed: 0.35,
} as const;

/** Fibras extra de cada línea dentro de la trenza: más finas, con otra fase, radio y paso. */
export const BRAID_FIBERS = [
  { radius: 0.028, intensity: 0.75, helix: 0.3, phase: 2.1, frequency: 1.3, speed: -0.8 },
  { radius: 0.022, intensity: 0.6, helix: 0.42, phase: 4.2, frequency: 0.8, speed: 1.25 },
] as const;

/** «Camino que no fue»: hebra muy tenue y fina que se deshilacha. */
export const GHOST_STYLE = { radius: 0.04, intensity: 0.42, fadeOut: 0.7 } as const;
/** Nodo de unión de al menos tantas líneas: más grande y siempre rotulado. */
export const BIG_UNION_LINES = 4;
export const BIG_UNION_SCALE = 1.28;

/** Realce de las hebras causales: discretas por defecto, encendidas al señalar uno de sus nodos. */
export const STRAND_EMPHASIS = { rest: 0.14, lit: 1.6, other: 0.1 } as const;

export interface SceneBuildOptions {
  readonly palette: ScenePalette;
  readonly fogDensity: number;
  /** Multiplicador de nº de partículas (movimiento reducido / móviles lo bajan). */
  readonly particleBudget: number;
}

export const DEFAULT_BUILD_OPTIONS: SceneBuildOptions = {
  palette: DEFAULT_PALETTE,
  fogDensity: 0.0068,
  particleBudget: 1,
};

export interface BuiltScene {
  readonly nodes: readonly NodeMesh[];
  readonly branches: readonly BranchCurve[];
  /** Costuras de las líneas que se fusionan. */
  readonly seams: readonly MergeSeam[];
  /** Hebras causales («esto llevó a esto»), del nodo origen al destino. */
  readonly strands: readonly BranchCurve[];
  /** «Caminos que no fueron»: hebras tenues que se disuelven enseguida. */
  readonly ghosts: readonly BranchCurve[];
  /** Puntas que avanzan por la línea de cada proyecto en activo. */
  readonly actives: readonly ActiveTip[];
  /** Resalta una línea (y atenúa las demás); `null` vuelve al estado normal. */
  highlightBranch(id: string | null): void;
  /** Ilumina las hebras causales que tocan estos eventos (señalado, seleccionado, paso de la historia). */
  highlightLinks(eventIds: readonly string[]): void;
  /** Re-layout: líneas, hebras y tramos aparecen desde cero. */
  fadeIn(): void;
  /** Todo lo que se actualiza por fotograma (ramas incluidas). */
  readonly effects: readonly SceneEffect[];
  readonly pulse: SelectionPulse;
  /** Velos y separadores de los arcos temporales. */
  readonly arcs: ArcBands;
  /** Fondo de acuarela (lo dibuja el postprocesado antes que la escena). */
  readonly backdrop: WatercolorWash;
  dispose(): void;
}

/** Traduce el modelo de vista (dominio) a objetos de escena. No conoce el renderer ni el DOM. */
export class SceneBuilder {
  private readonly options: SceneBuildOptions;

  constructor(options: Partial<SceneBuildOptions> = {}) {
    this.options = { ...DEFAULT_BUILD_OPTIONS, ...options };
  }

  build(model: TimelineViewModel): BuiltScene {
    const { timeline, layout } = model;
    const { palette, fogDensity, particleBudget } = this.options;
    const assets = new NodeAssets(createRingTexture());

    // Un solo código de color: el de la línea vital. Nodos, tramos, motas y chispas lo comparten.
    const colorOfLine = (id: string): string => timeline.lineColorOf(id) ?? palette.trunk;
    const lineCount = Math.max(1, layout.branches.length);

    // Cada línea: filamento principal (grueso y brillante en la trenza, fino y tenue en su carril)
    // y, dentro de la trenza, dos fibras más finas que se entrelazan con las de las demás líneas.
    // Una línea en pausa se dibuja en varios tramos: el anterior a la pausa se disuelve en motas y
    // el siguiente renace en el nodo donde termina la pausa.
    const tail = layout.nodeStep * 0.55;
    const pieces = layout.branches.flatMap((branch, order) =>
      branchPieces(branch).map((piece, k, all) => ({ branch, order, piece, k, last: k === all.length - 1 })),
    );
    const branches = pieces.map(({ branch, order, piece, k: pieceIndex, last }) => {
      const merges = branch.merge !== null && last;
      const color = colorOfLine(branch.id);
      const braid = piece.braid;
      const phase = (order / lineCount) * Math.PI * 2;
      const length = Math.max(1e-3, piece.points[piece.points.length - 1].x - piece.points[0].x);
      const style: BranchStyle = {
        color,
        radius: BRAID_STYLE.radius,
        intensity: BRAID_STYLE.intensity,
        fadeIn: pieceIndex > 0 ? Math.min(0.3, (tail * 0.4) / length) : 0.04,
        fadeOut: !last ? Math.min(0.6, tail / length) : branch.open ? 0.04 : merges ? 0.015 : 0.3,
        flowSpeed: 0.11,
        fogDensity,
        focus: braid.map((w) => BRAID_STYLE.outer + (1 - BRAID_STYLE.outer) * w),
        widths: braid.map((w) => BRAID_STYLE.outerWidth + (1 - BRAID_STYLE.outerWidth) * w),
        braid,
        helix: { radius: BRAID_STYLE.helix, phase, frequency: BRAID_STYLE.frequency, speed: BRAID_STYLE.speed },
      };
      const curve = new BranchCurve(pieceIndex === 0 ? branch.id : `${branch.id}#${pieceIndex}`, piece.points, style);
      const inBraid = braid.some((w) => w > 0.5);
      const fibers = inBraid
        ? BRAID_FIBERS.map(
            (fiber, k) =>
              new BranchCurve(`fiber:${branch.id}:${k}${pieceIndex > 0 ? `#${pieceIndex}` : ''}`, piece.points, {
                ...style,
                radius: fiber.radius,
                intensity: fiber.intensity,
                widths: undefined,
                focus: undefined,
                braidOnly: true,
                helix: { radius: fiber.helix, phase: phase + fiber.phase, frequency: BRAID_STYLE.frequency * fiber.frequency, speed: BRAID_STYLE.speed * fiber.speed },
              }),
          )
        : [];
      // Una rama que no llega al presente (ni converge en otra) se deshace en polvo al final.
      const dissolve = !last || (!branch.open && !merges) ? style.fadeOut : 0;
      return { branch, curve, fibers, color, dissolve, points: piece.points, braid };
    });
    const branchById = new Map(layout.branches.map((branch) => [branch.id, branch]));

    // Chispas: uniones y separaciones con la trenza (pequeñas) y fusiones (costura completa).
    const seams = layout.junctions.map((junction) => {
      const color = colorOfLine(junction.branch);
      if (junction.kind === 'merge') {
        const into = branchById.get(junction.branch)?.merge?.into ?? junction.branch;
        return new MergeSeam(junction.branch, junction.position, color, colorOfLine(into), { count: 26, radius: 0.9, core: 0.9 });
      }
      if (junction.kind === 'fray') {
        // La línea se deshilacha: motas de su color que se dispersan, sin destello.
        return new MergeSeam(`fray:${junction.branch}@${junction.position.x}`, junction.position, color, palette.background, {
          count: 14,
          radius: 0.75,
          core: 0,
          seed: Math.round(junction.position.x * 10) + 5,
        });
      }
      return new MergeSeam(`${junction.kind}:${junction.branch}@${junction.position.x}`, junction.position, color, '#ffffff', {
        count: 16,
        radius: 0.6,
        core: 0.45,
        seed: Math.round(junction.position.x * 10) + 3,
      });
    });

    // Hebras causales: tinta que va del color de la línea origen al de la destino. Si cambian de
    // línea, un remolino de pigmento marca dónde se unen.
    const lineColorById = new Map(branches.map(({ branch, color }) => [branch.id, color]));
    const strands = layout.links.map(
      (link) =>
        new BranchCurve(`link:${link.from}>${link.to}`, link.points, {
          color: lineColorById.get(link.fromBranch) ?? palette.trunk,
          colorEnd: lineColorById.get(link.toBranch) ?? palette.trunk,
          radius: 0.035,
          intensity: 0.7,
          fadeIn: 0.06,
          fadeOut: 0.06,
          flowSpeed: 0.12,
          fogDensity,
        }),
    );
    const swirls = layout.links
      .filter((link) => link.fromBranch !== link.toBranch)
      .map((link) => {
        const target = link.points[link.points.length - 1];
        return new MergeSeam(
          `swirl:${link.from}>${link.to}`,
          target,
          lineColorById.get(link.fromBranch) ?? palette.trunk,
          lineColorById.get(link.toBranch) ?? palette.trunk,
          { count: 14, radius: 0.55, core: 0 },
        );
      });

    // Tramos de duración: un filamento más grueso y tenue del color de su línea (fuera de la trenza:
    // dentro, la trenza ya es lo bastante densa).
    const spans = layout.nodes
      .filter((node) => node.span && node.span.length >= 2 && node.position.y !== 0)
      .map(
        (node) =>
          new BranchCurve(`span:${node.eventId}`, node.span ?? [], {
            color: colorOfLine(node.branch),
            radius: 0.1,
            intensity: 0.12,
            fadeIn: 0.03,
            fadeOut: 0.12,
            flowSpeed: 0.05,
            fogDensity,
          }),
      );

    const nodes = layout.nodes.map((node, index) => {
      const event = timeline.getEvent(node.eventId);
      return new NodeMesh(
        {
          eventId: node.eventId,
          position: node.position,
          color: colorOfLine(node.branch),
          style: timeline.lineStyleOf(node.branch),
          importance: event?.importance ?? 2,
          phase: index * 1.37,
          // Encrucijada: anillo con los colores de las líneas que pasan; activo: anillo de su línea.
          ringColors: node.lines.length > 1 ? node.lines.map(colorOfLine) : event?.active ? [colorOfLine(node.branch)] : undefined,
          active: event?.active === true,
          scale: node.lines.length >= BIG_UNION_LINES ? BIG_UNION_SCALE : 1,
        },
        assets,
      );
    });

    // Motas: la trenza es la protagonista (flujo denso que la recorre girando a su alrededor); en
    // las ramas exteriores, apenas unas pocas.
    const braidPaths: FlowPath[] = branches.map(({ branch, curve, color, points, braid }) => ({
      id: branch.id,
      path: curve.path,
      color,
      focus: sampleAlongPath(curve.path, points, braid),
    }));
    const outerPaths: FlowPath[] = branches.map(({ branch, curve, color, dissolve, points, braid }) => ({
      id: branch.id,
      path: curve.path,
      color,
      dissolve,
      focus: sampleAlongPath(
        curve.path,
        points,
        braid.map((w) => 1 - w),
      ),
    }));
    const backdrop = new WatercolorWash(
      branches.map(({ branch, color, points, braid }) => ({
        color,
        points,
        focus: braid.map((w) => 0.25 + 0.75 * w),
        main: branch.main,
      })),
      { ...DEFAULT_WATERCOLOR, paper: palette.background },
    );

    // Caminos que no fueron: hebra tenue del color de la línea que se disuelve en unas motas.
    const ghosts = layout.ghosts.map(
      (ghost) =>
        new BranchCurve(`ghost:${ghost.id}`, ghost.points, {
          color: colorOfLine(ghost.id),
          radius: GHOST_STYLE.radius,
          intensity: GHOST_STYLE.intensity,
          fadeIn: 0.08,
          fadeOut: GHOST_STYLE.fadeOut,
          flowSpeed: 0.05,
          fogDensity,
        }),
    );
    const ghostMotes = layout.ghosts.map((ghost) => {
      const end = ghost.points[Math.floor(ghost.points.length * 0.7)];
      return new MergeSeam(`ghost-fray:${ghost.id}`, end, colorOfLine(ghost.id), palette.background, {
        count: 10,
        radius: 0.6,
        core: 0,
        seed: Math.round(end.x * 10) + 9,
      });
    });
    // Proyectos en activo: una punta que avanza por su línea hasta hoy.
    const actives = layout.actives.map((active) => new ActiveTip(active.eventId, active.points, colorOfLine(active.branch)));

    const pulse = new SelectionPulse(assets.ring);
    const arcs = new ArcBands(layout.arcs, layout.bounds);
    const flow = new ParticleFlow(braidPaths, {
      density: 2.4 * particleBudget,
      maxParticles: Math.round(1400 * particleBudget),
      clearBand: false,
      orbitScale: 0.55,
      floor: 0,
      weighted: true,
      seed: 7,
    });
    const outerFlow = new ParticleFlow(outerPaths, {
      density: 0.06 * particleBudget,
      maxParticles: Math.round(120 * particleBudget),
      floor: 0,
      orbitScale: 0.6,
      seed: 19,
    });
    for (const strand of strands) strand.setEmphasisValue(STRAND_EMPHASIS.rest);
    const effects: SceneEffect[] = [
      backdrop,
      // Meridianos entre años: medio paso antes del primer nodo de cada año (no cruzan los símbolos).
      new YearMarkers(
        layout.years.map((mark) => ({ ...mark, x: mark.x - layout.nodeStep / 2 })),
        layout.bounds,
      ),
      arcs,
      ...branches.flatMap(({ curve, fibers }) => [curve, ...fibers]),
      ...spans,
      ...strands,
      ...ghosts,
      flow,
      outerFlow,
      ...seams,
      ...swirls,
      ...ghostMotes,
      ...actives,
      pulse,
    ];

    return {
      nodes,
      branches: branches.map(({ curve }) => curve),
      seams,
      strands,
      ghosts,
      actives,
      highlightBranch: (id) => {
        for (const { branch, curve, fibers } of branches) {
          const emphasis = id === null ? 'none' : branch.id === id ? 'on' : 'off';
          for (const item of [curve, ...fibers]) item.setEmphasis(emphasis);
        }
        flow.highlight(id);
        outerFlow.highlight(id);
      },
      highlightLinks: (eventIds) => {
        const lit = new Set(eventIds);
        layout.links.forEach((link, i) => {
          const on = lit.has(link.from) || lit.has(link.to);
          strands[i].setEmphasisValue(on ? STRAND_EMPHASIS.lit : lit.size > 0 ? STRAND_EMPHASIS.other : STRAND_EMPHASIS.rest);
        });
      },
      fadeIn: () => {
        for (const curve of [...branches.flatMap(({ curve, fibers }) => [curve, ...fibers]), ...strands, ...spans, ...ghosts]) curve.fadeIn();
      },
      effects,
      pulse,
      arcs,
      backdrop,
      dispose: () => {
        for (const effect of effects) effect.dispose();
        for (const node of nodes) node.dispose();
        assets.dispose();
      },
    };
  }
}
