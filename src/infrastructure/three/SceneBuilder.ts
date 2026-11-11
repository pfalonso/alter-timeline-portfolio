import type { TimelineViewModel } from '../../application/ports';
import { ArcBands } from './ArcBands';
import { BranchCurve, type BranchStyle } from './BranchCurve';
import { sampleAlongPath, smoothstep, valueAtX } from './math';
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
  readonly trunk: string;
  readonly fallbackNode: string;
}

export const DEFAULT_PALETTE: ScenePalette = {
  background: DEFAULT_WATERCOLOR.paper,
  trunk: '#a9d4ff',
  fallbackNode: '#cfe4ff',
};

/** Fuera de la banda las líneas se desvanecen un poco: el ojo sigue los nodos, no las hebras. */
export function bandFade(y: number, bandHalf = 1.6, far = 6.5): number {
  return 1 - 0.45 * smoothstep(bandHalf, far, Math.abs(y));
}

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
  /** Resalta una línea (y atenúa las demás); `null` vuelve al estado normal. */
  highlightBranch(id: string | null): void;
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

    const colorOfEvent = (eventId: string): string => {
      const event = timeline.getEvent(eventId);
      return (event && timeline.primaryCategoryOf(event)?.color) ?? palette.fallbackNode;
    };

    // Líneas: la central es pálida salvo que declare color; las demás usan el suyo o el de la
    // categoría principal de su primer evento. El foco modula brillo, grosor y partículas.
    const colorOfLine = (id: string, main: boolean): string =>
      (main ? timeline.getLine(id)?.color : timeline.lineColorOf(id)) ?? palette.trunk;
    const branches = layout.branches.map((branch) => {
      const isTrunk = branch.main;
      const merges = branch.merge !== null;
      const hasFocus = (timeline.getLine(branch.id)?.focus.length ?? 0) > 0;
      // La central engorda un poco al acercarse a hoy: es la línea en foco actual.
      const widths = branch.points.map((point, i) => {
        const focusWidth = hasFocus ? 0.75 + 0.35 * branch.focus[i] : 1;
        return focusWidth * (isTrunk ? 1 + 0.5 * smoothstep(layout.nowX - 22, layout.nowX, point.x) : 1);
      });
      const style: BranchStyle = {
        color: colorOfLine(branch.id, isTrunk),
        radius: isTrunk ? 0.075 : 0.055,
        intensity: isTrunk ? 0.95 : 0.72,
        fadeIn: isTrunk ? 0.06 : 0.02,
        fadeOut: isTrunk ? 0.05 : branch.open ? 0.04 : merges ? 0.015 : 0.3,
        flowSpeed: 0.11,
        fogDensity,
        focus: branch.focus.map((value, i) => value * bandFade(branch.points[i].y)),
        widths,
      };
      // Una rama que no llega al presente (ni converge en otra) se deshace en polvo al final.
      const dissolve = !isTrunk && !branch.open && !merges ? style.fadeOut : 0;
      return { branch, curve: new BranchCurve(branch.id, branch.points, style), color: style.color, dissolve };
    });
    const branchById = new Map(layout.branches.map((branch) => [branch.id, branch]));
    const focusAtNode = (branchId: string, x: number): number => {
      const branch = branchById.get(branchId);
      return branch ? valueAtX(branch.points, branch.focus, x) : 1;
    };

    // Costuras: donde una línea converge en otra.
    const seams = branches
      .filter(({ branch }) => branch.merge !== null)
      .map(({ branch, color }) => {
        const merge = branch.merge as NonNullable<typeof branch.merge>;
        const target = branchById.get(merge.into);
        return new MergeSeam(branch.id, merge.position, color, colorOfLine(merge.into, target?.main ?? false));
      });

    // Tramos de duración: un filamento más grueso y tenue del color de la categoría.
    const spans = layout.nodes
      .filter((node) => node.span && node.span.length >= 2)
      .map(
        (node) =>
          new BranchCurve(`span:${node.eventId}`, node.span ?? [], {
            color: colorOfEvent(node.eventId),
            radius: 0.15,
            intensity: 0.34 * focusAtNode(node.branch, node.position.x),
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
          color: colorOfEvent(node.eventId),
          style: timeline.lineStyleOf(node.branch),
          importance: event?.importance ?? 2,
          phase: index * 1.37,
        },
        assets,
      );
    });

    const flowPaths: FlowPath[] = branches.map(({ branch, curve, color, dissolve }) => ({
      id: branch.id,
      path: curve.path,
      color,
      dissolve,
      focus: sampleAlongPath(curve.path, branch.points, branch.focus),
    }));
    const backdrop = new WatercolorWash(
      branches.map(({ branch, color }) => ({ color, points: branch.points, focus: branch.focus, main: branch.main })),
      { ...DEFAULT_WATERCOLOR, paper: palette.background },
    );

    const pulse = new SelectionPulse(assets.ring);
    const arcs = new ArcBands(layout.arcs, layout.bounds);
    const flow = new ParticleFlow(flowPaths, { density: 2.6 * particleBudget, maxParticles: Math.round(2400 * particleBudget) });
    const effects: SceneEffect[] = [
      backdrop,
      new YearMarkers(layout.years, layout.bounds),
      arcs,
      ...branches.map(({ curve }) => curve),
      ...spans,
      flow,
      ...seams,
      pulse,
    ];

    return {
      nodes,
      branches: branches.map(({ curve }) => curve),
      seams,
      highlightBranch: (id) => {
        for (const { curve } of branches) curve.setEmphasis(id === null ? 'none' : curve.id === id ? 'on' : 'off');
        flow.highlight(id);
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
