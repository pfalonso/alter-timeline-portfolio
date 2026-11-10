import {
  AdditiveBlending,
  Color,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { Vec3 } from '../../domain/services';
import { damp, smoothstep } from './math';
import type { FrameContext } from './types';

export interface NodeSpec {
  readonly eventId: string;
  readonly position: Vec3;
  readonly color: string;
  /** Colores de las categorías secundarias (satélites en órbita). */
  readonly secondaryColors: readonly string[];
  readonly importance: 1 | 2 | 3;
  /** Desfase para que los nodos no pulsen al unísono. */
  readonly phase: number;
}

/** Geometrías y texturas compartidas por todos los nodos. */
export class NodeAssets {
  readonly core: BufferGeometry = new IcosahedronGeometry(1, 1);
  readonly shell: BufferGeometry = new EdgesGeometry(new OctahedronGeometry(1, 0));
  readonly satellite: BufferGeometry = new SphereGeometry(1, 8, 6);

  constructor(
    readonly glow: Texture,
    readonly ring: Texture,
  ) {}

  dispose(): void {
    this.core.dispose();
    this.shell.dispose();
    this.satellite.dispose();
    this.glow.dispose();
    this.ring.dispose();
  }
}

export const NODE_RADIUS: Record<1 | 2 | 3, number> = { 1: 0.3, 2: 0.44, 3: 0.64 };
/** Presencia de un nodo filtrado: se atenúa, no desaparece. */
export const DIMMED_PRESENCE = 0.1;

/** Un evento en la escena: núcleo cristalino, jaula giratoria, halo pulsante, anillo y satélites. */
export class NodeMesh {
  readonly group = new Group();
  readonly eventId: string;
  readonly radius: number;
  readonly importance: 1 | 2 | 3;
  readonly color: string;

  private presenceValue = 1;
  private presenceTarget = 1;
  private hover = 0;
  private hoverTarget = 0;
  private focus = 0;
  private focusTarget = 0;

  private readonly coreMaterial: MeshBasicMaterial;
  private readonly shellMaterial: LineBasicMaterial;
  private readonly haloMaterial: SpriteMaterial;
  private readonly ringMaterial: SpriteMaterial;
  private readonly satelliteMaterials: MeshBasicMaterial[] = [];
  private readonly body = new Group();
  private readonly shell: LineSegments;
  private readonly halo: Sprite;
  private readonly ring: Sprite;
  private readonly satellites: Mesh[] = [];
  private readonly phase: number;
  private nearFade = 1;

  constructor(spec: NodeSpec, assets: NodeAssets) {
    this.eventId = spec.eventId;
    this.importance = spec.importance;
    this.radius = NODE_RADIUS[spec.importance];
    this.color = spec.color;
    this.phase = spec.phase;
    this.group.name = `node:${spec.eventId}`;
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);

    const base = new Color(spec.color);
    this.coreMaterial = new MeshBasicMaterial({
      color: base.clone().lerp(new Color('#ffffff'), 0.22),
      transparent: true,
    });
    const core = new Mesh(assets.core, this.coreMaterial);
    core.scale.setScalar(this.radius);

    this.shellMaterial = new LineBasicMaterial({ color: base, transparent: true, opacity: 0.75, depthWrite: false });
    this.shell = new LineSegments(assets.shell, this.shellMaterial);
    this.shell.scale.setScalar(this.radius * 1.95);

    this.haloMaterial = new SpriteMaterial({
      map: assets.glow,
      color: base,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.halo = new Sprite(this.haloMaterial);

    this.ringMaterial = new SpriteMaterial({
      map: assets.ring,
      color: base.clone().lerp(new Color('#ffffff'), 0.3),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.ring = new Sprite(this.ringMaterial);

    this.body.add(core, this.shell);
    spec.secondaryColors.forEach((hex) => {
      const material = new MeshBasicMaterial({ color: new Color(hex).lerp(new Color('#ffffff'), 0.25), transparent: true });
      const satellite = new Mesh(assets.satellite, material);
      satellite.scale.setScalar(this.radius * 0.24);
      this.satelliteMaterials.push(material);
      this.satellites.push(satellite);
      this.body.add(satellite);
    });
    this.group.add(this.halo, this.ring, this.body);
    this.apply(0);
  }

  /** 0 (atenuado) … 1 (visible), ya interpolado. */
  get presence(): number {
    return this.presenceValue;
  }

  get highlighted(): boolean {
    return this.hoverTarget > 0 || this.focusTarget > 0;
  }

  /** Escala actual del cuerpo (para calcular el radio aparente). */
  get scale(): number {
    return this.body.scale.x;
  }

  setVisible(visible: boolean, immediate = false): void {
    this.presenceTarget = visible ? 1 : DIMMED_PRESENCE;
    if (immediate) this.presenceValue = this.presenceTarget;
  }

  setHovered(hovered: boolean): void {
    this.hoverTarget = hovered ? 1 : 0;
  }

  setFocused(focused: boolean): void {
    this.focusTarget = focused ? 1 : 0;
  }

  update(frame: FrameContext): void {
    if (frame.reducedMotion) {
      this.presenceValue = this.presenceTarget;
      this.hover = this.hoverTarget;
      this.focus = this.focusTarget;
    } else {
      this.presenceValue = damp(this.presenceValue, this.presenceTarget, 4.5, frame.delta);
      this.hover = damp(this.hover, this.hoverTarget, 10, frame.delta);
      this.focus = damp(this.focus, this.focusTarget, 6, frame.delta);
    }
    // De cerca el halo se contiene para que el color de la categoría no se queme a blanco.
    const distance = frame.camera.position.distanceTo(this.group.position);
    this.nearFade = 0.5 + 0.5 * smoothstep(14, 46, distance);
    this.apply(frame.reducedMotion ? 0 : frame.time);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.coreMaterial.dispose();
    this.shellMaterial.dispose();
    this.haloMaterial.dispose();
    this.ringMaterial.dispose();
    for (const material of this.satelliteMaterials) material.dispose();
  }

  private apply(time: number): void {
    const p = this.presenceValue;
    const beat = Math.sin(time * 1.25 + this.phase);
    const r = this.radius;

    this.body.scale.setScalar((0.6 + 0.4 * p) * (1 + 0.22 * this.hover + 0.16 * this.focus));
    this.coreMaterial.opacity = 0.12 + 0.88 * p;
    this.shellMaterial.opacity = 0.75 * p * p;
    this.shell.rotation.set(time * 0.23 + this.phase, time * 0.41 + this.phase * 2, 0);

    const haloScale = r * (6.5 + this.importance * 1.4) * (1 + 0.1 * beat + 0.3 * this.hover + 0.25 * this.focus);
    this.halo.scale.set(haloScale, haloScale, 1);
    this.haloMaterial.opacity = (0.3 + 0.08 * beat + 0.22 * this.hover + 0.18 * this.focus) * p * p * this.nearFade;

    const ringScale = r * (5.2 + 0.25 * beat + 1.2 * this.focus);
    this.ring.scale.set(ringScale, ringScale, 1);
    this.ringMaterial.opacity = Math.min(1, (this.importance === 3 ? 0.3 : 0) + 0.85 * this.focus + 0.35 * this.hover) * p;

    this.satellites.forEach((satellite, index) => {
      const angle = time * 0.7 + this.phase + (index * Math.PI * 2) / this.satellites.length;
      const tilt = 0.5 + index * 0.9;
      const orbit = r * 2.7;
      satellite.position.set(Math.cos(angle) * orbit, Math.sin(angle) * Math.cos(tilt) * orbit, Math.sin(angle) * Math.sin(tilt) * orbit);
      this.satelliteMaterials[index].opacity = p;
    });
  }
}
