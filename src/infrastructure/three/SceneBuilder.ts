import type { TimelineViewModel } from '../../application/ports';
import { ArcBands } from './ArcBands';
import { BranchCurve, type BranchStyle } from './BranchCurve';
import { sampleAlongPath, smoothstep, valueAtX } from './math';
import { MergeSeam } from './MergeSeam';
import { Nebula } from './Nebula';
import { NodeAssets, NodeMesh } from './NodeMesh';
import { ParticleFlow, type FlowPath } from './ParticleFlow';
import type { SceneEffect } from './SceneEffect';
import { SelectionPulse } from './SelectionPulse';
import { Starfield, type StarLayer } from './Starfield';
import { createRingTexture } from './textures';
import { YearMarkers } from './YearMarkers';

export interface ScenePalette {
  readonly background: string;
  readonly trunk: string;
  readonly fallbackNode: string;
  readonly nebula: readonly [string, string, string];
  readonly stars: readonly string[];
  readonly dust: readonly string[];
}

export const DEFAULT_PALETTE: ScenePalette = {
  background: '#04050d',
  trunk: '#a9d4ff',
  fallbackNode: '#cfe4ff',
  nebula: ['#0a1640', '#0a3d52', '#3b1a63'],
  stars: ['#ffffff', '#cfe0ff', '#ffe9d2', '#a8c8ff'],
  dust: ['#7fd6ff', '#b79cff', '#ffd6a8', '#8affd9'],
};

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
        intensity: isTrunk ? 1 : 0.85,
        fadeIn: isTrunk ? 0.06 : 0.02,
        fadeOut: isTrunk ? 0.05 : branch.open ? 0.04 : merges ? 0.015 : 0.3,
        flowSpeed: 0.11,
        fogDensity,
        focus: branch.focus,
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
    const { minX, maxX, minY, maxY } = layout.bounds;
    const wide: [number, number] = [minX - 260, maxX + 260];
    const starLayers: StarLayer[] = [
      { count: 2600, x: wide, y: [-190, 190], z: [-300, -120], size: [0.5, 2.6], alpha: [0.25, 0.95], palette: palette.stars, drift: 0 },
      { count: 700, x: [minX - 120, maxX + 120], y: [minY - 60, maxY + 60], z: [-110, -30], size: [0.35, 1.3], alpha: [0.2, 0.7], palette: palette.stars, drift: 0 },
      {
        count: Math.round(520 * particleBudget),
        x: [minX - 40, maxX + 40],
        y: [minY - 16, maxY + 16],
        z: [-24, 14],
        size: [0.1, 0.42],
        alpha: [0.12, 0.5],
        palette: palette.dust,
        drift: 0.7,
      },
    ];

    const pulse = new SelectionPulse(assets.ring);
    const arcs = new ArcBands(layout.arcs, layout.bounds);
    const flow = new ParticleFlow(flowPaths, { density: 2.6 * particleBudget, maxParticles: Math.round(2400 * particleBudget) });
    const effects: SceneEffect[] = [
      new Nebula(palette.nebula),
      new Starfield(starLayers),
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
      dispose: () => {
        for (const effect of effects) effect.dispose();
        for (const node of nodes) node.dispose();
        assets.dispose();
      },
    };
  }
}
