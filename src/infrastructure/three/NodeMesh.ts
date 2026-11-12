import {
  AdditiveBlending,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { LineStyle } from '../../domain/model';
import type { Vec3 } from '../../domain/services';
import { damp } from './math';
import { createNodeShape, type NodeShape } from './NodeShapes';
import type { FrameContext } from './types';

export interface NodeSpec {
  readonly eventId: string;
  readonly position: Vec3;
  /** Color de SU línea vital (no de la categoría): el nodo se lee como parte de la línea. */
  readonly color: string;
  readonly importance: 1 | 2 | 3;
  /** Lenguaje de forma de la línea a la que pertenece (por defecto, neutro). */
  readonly style?: LineStyle;
  /** Desfase para que los nodos no giren al unísono. */
  readonly phase: number;
  /**
   * Anillo exterior por segmentos con estos colores: en un nodo de unión, los de las líneas que
   * pasan por él (encrucijada); en un proyecto activo sin unión, el de su línea.
   */
  readonly ringColors?: readonly string[];
  /** Proyecto en activo: el aura y el anillo laten despacio (quietos con movimiento reducido). */
  readonly active?: boolean;
  /** Multiplicador de tamaño (nodos de unión de muchas líneas). */
  readonly scale?: number;
}

/** Anillo de la encrucijada: radios interior/exterior (en radios del nodo) y hueco entre segmentos. */
export const UNION_RING = { inner: 1.38, outer: 1.5, gap: 0.14, opacity: 0.62 } as const;
/** Latido de un nodo activo: periodo (s) y cuánto sube el aura en cada golpe. */
export const HEARTBEAT = { period: 2.4, aura: 0.2, ring: 0.35 } as const;

/** Latido «lub-dub» suave (0..1) en el instante `time`. */
export function heartbeat(time: number, phase = 0): number {
  const t = (((time + phase) % HEARTBEAT.period) + HEARTBEAT.period) % HEARTBEAT.period / HEARTBEAT.period;
  const bump = (center: number, width: number): number => Math.exp(-(((t - center) / width) ** 2));
  return Math.min(1, bump(0.1, 0.06) + 0.55 * bump(0.27, 0.07));
}

/**
 * Recursos compartidos por todos los nodos: el cuadro del aura, la textura de anillo del pulso y
 * las geometrías de cada forma (una por estilo y peso, creadas al pedirlas).
 */
export class NodeAssets {
  readonly quad: BufferGeometry = new PlaneGeometry(2, 2);
  private readonly shapes = new Map<string, NodeShape>();

  constructor(readonly ring: Texture) {}

  shape(style: LineStyle, importance: 1 | 2 | 3): NodeShape {
    const key = `${style}:${importance}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = createNodeShape(style, importance);
      this.shapes.set(key, shape);
    }
    return shape;
  }

  dispose(): void {
    this.quad.dispose();
    this.ring.dispose();
    for (const shape of this.shapes.values()) {
      shape.wire.dispose();
      shape.inner?.dispose();
      shape.fill.dispose();
    }
    this.shapes.clear();
  }
}

/** Jerarquía: mayor = sólido grande; medio = mediano; menor = pequeño. */
export const NODE_RADIUS: Record<1 | 2 | 3, number> = { 1: 0.26, 2: 0.46, 3: 0.78 };

/** Cómo se presenta cada peso. */
export interface NodeTier {
  /** Aura de luz en reposo (las demás solo al señalarlas). */
  readonly aura: boolean;
  /** Cuánto crece el sólido al señalarlo (los menores, más: si no, cuesta ver dónde está el cursor). */
  readonly lift: number;
  /** Brillo de las aristas en reposo. */
  readonly glow: number;
}

export const NODE_TIERS: Record<1 | 2 | 3, NodeTier> = {
  1: { aura: false, lift: 0.7, glow: 0.62 },
  2: { aura: false, lift: 0.24, glow: 0.8 },
  3: { aura: true, lift: 0.16, glow: 0.95 },
};
/** Presencia de un nodo filtrado: se atenúa, no desaparece. */
export const DIMMED_PRESENCE = 0.1;
/** Duración del deslizamiento de un nodo tras cambiar los filtros. */
export const SLIDE_SECONDS = 0.75;
/** Giro sobre sí mismos (radianes por segundo); con movimiento reducido, quietos. */
export const SPIN_SPEED = 0.32;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Color del papel: el relleno interior es papel apenas teñido del color de la línea. */
export const GLYPH_PAPER = '#171029';
/** Tinte del relleno interior (0 = papel, 1 = color de la línea). */
export const FILL_TINT = 0.2;

const AURA_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const AURA_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float glow = exp(-d * d * 4.5) * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(uColor * glow * uStrength, glow * uStrength);
  }
`;

/**
 * Un evento en la escena: sólido 3D en *wireframe* (aristas luminosas del color de su línea, relleno
 * interior tenue) que gira despacio sobre sí mismo. Al señalarlo se expande y brilla un poco.
 */
export class NodeMesh {
  readonly group = new Group();
  readonly eventId: string;
  readonly radius: number;
  readonly importance: 1 | 2 | 3;
  readonly color: string;
  readonly style: LineStyle;
  /** Lo que gira: aristas, estructura interior y relleno. */
  readonly spinner = new Group();
  readonly wire: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly inner: LineSegments<BufferGeometry, LineBasicMaterial> | null;
  readonly fill: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly aura: Mesh<BufferGeometry, ShaderMaterial>;
  /** Anillo multicolor (encrucijada o activo), siempre de cara a la cámara; `null` si no lo hay. */
  readonly ring: Group | null = null;
  readonly active: boolean;
  /** Nº de líneas que pasan por el nodo (1 si no es de unión). */
  readonly lineCount: number;

  private presenceValue = 1;
  private presenceTarget = 1;
  private hover = 0;
  private hoverTarget = 0;
  private focus = 0;
  private focusTarget = 0;
  private readonly tier: NodeTier;
  private readonly phase: number;
  /** Deslizamiento tras un re-layout: de `slide.from` a la posición final, en `SLIDE_SECONDS`. */
  private slide: { readonly from: Vec3; readonly to: Vec3; t: number } | null = null;

  constructor(spec: NodeSpec, assets: NodeAssets) {
    this.eventId = spec.eventId;
    this.importance = spec.importance;
    this.radius = NODE_RADIUS[spec.importance] * (spec.scale ?? 1);
    this.active = spec.active === true;
    this.lineCount = Math.max(1, spec.ringColors?.length ?? 1);
    this.color = spec.color;
    this.style = spec.style ?? 'neutral';
    this.phase = spec.phase;
    this.tier = NODE_TIERS[spec.importance];
    this.group.name = `node:${spec.eventId}`;
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);

    const shape = assets.shape(this.style, spec.importance);
    const lineColor = new Color(spec.color).lerp(new Color('#ffffff'), 0.12);
    const lineMaterial = (): LineBasicMaterial =>
      new LineBasicMaterial({ color: lineColor, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.wire = new LineSegments(shape.wire, lineMaterial());
    this.wire.name = `wire:${spec.eventId}`;
    this.wire.renderOrder = 6;
    this.inner = shape.inner ? new LineSegments(shape.inner, lineMaterial()) : null;
    if (this.inner) {
      this.inner.name = `inner:${spec.eventId}`;
      this.inner.renderOrder = 6;
    }
    // Relleno: papel apenas teñido. Va después de las líneas y las tapa al pasar por detrás.
    this.fill = new Mesh(
      shape.fill,
      new MeshBasicMaterial({
        color: new Color(GLYPH_PAPER).lerp(new Color(spec.color), FILL_TINT),
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    );
    this.fill.name = `fill:${spec.eventId}`;
    this.fill.renderOrder = 5;
    this.aura = new Mesh(
      assets.quad,
      new ShaderMaterial({
        vertexShader: AURA_VERTEX,
        fragmentShader: AURA_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color(spec.color) }, uStrength: { value: 0 } },
      }),
    );
    this.aura.name = `aura:${spec.eventId}`;
    this.aura.renderOrder = 4;
    this.spinner.add(this.fill, this.wire, ...(this.inner ? [this.inner] : []));
    // Inclinación inicial distinta por nodo: no se ven todos de la misma cara.
    this.spinner.rotation.set(0.45 + (spec.phase % 0.6), spec.phase % (Math.PI * 2), 0.2);
    this.group.add(this.aura, this.spinner);
    if (spec.ringColors && spec.ringColors.length > 0) {
      this.ring = createRing(spec.ringColors, this.radius);
      this.ring.name = `ring:${spec.eventId}`;
      this.group.add(this.ring);
    }
    this.apply(0, 0);
  }

  /** 0 (atenuado) … 1 (visible), ya interpolado. */
  get presence(): number {
    return this.presenceValue;
  }

  get highlighted(): boolean {
    return this.hoverTarget > 0 || this.focusTarget > 0;
  }

  /** Escala actual del sólido respecto a su tamaño en reposo (para el radio aparente). */
  get scale(): number {
    return this.spinner.scale.x / this.radius;
  }

  /** Atención actual (0..1): cuánto se ha expandido por hover/foco. */
  get attention(): number {
    return Math.max(this.hover, this.focus);
  }

  setVisible(visible: boolean, immediate = false): void {
    this.presenceTarget = visible ? 1 : DIMMED_PRESENCE;
    if (immediate) this.presenceValue = this.presenceTarget;
  }

  /**
   * Re-layout: el nodo parte de `from` y se desliza hasta su posición (curva suave). Con movimiento
   * reducido salta directamente.
   */
  slideFrom(from: Vec3): void {
    const p = this.group.position;
    const to = { x: p.x, y: p.y, z: p.z };
    if (Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) < 1e-3) return;
    this.slide = { from, to, t: 0 };
    p.set(from.x, from.y, from.z);
  }

  /** Aparece desde cero (nodo que el filtro acaba de mostrar). */
  fadeIn(): void {
    this.presenceValue = 0;
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
    if (this.slide) {
      const slide = this.slide;
      slide.t = frame.reducedMotion ? 1 : Math.min(1, slide.t + frame.delta / SLIDE_SECONDS);
      const k = easeInOut(slide.t);
      this.group.position.set(
        slide.from.x + (slide.to.x - slide.from.x) * k,
        slide.from.y + (slide.to.y - slide.from.y) * k,
        slide.from.z + (slide.to.z - slide.from.z) * k,
      );
      if (slide.t >= 1) this.slide = null;
    }
    // El aura y el anillo siempre miran a la cámara.
    this.aura.quaternion.copy(frame.camera.quaternion);
    this.ring?.quaternion.copy(frame.camera.quaternion);
    this.beat = this.active && !frame.reducedMotion ? heartbeat(frame.time, this.phase) : 0;
    this.apply(frame.reducedMotion ? 0 : frame.delta, frame.reducedMotion ? 0 : frame.time);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.wire.material.dispose();
    this.inner?.material.dispose();
    this.fill.material.dispose();
    this.aura.material.dispose();
    this.ring?.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as MeshBasicMaterial).dispose();
      }
    });
  }

  /** Latido actual (0..1); 0 si no es activo o con movimiento reducido. */
  private beat = 0;

  private apply(delta: number, time: number): void {
    const p = this.presenceValue;
    const a = this.attention;
    // Giro lento; el señalado gira algo más deprisa. La estructura interior gira al revés.
    const spin = SPIN_SPEED * (1 + 0.8 * a) * (0.85 + 0.3 * Math.sin(this.phase));
    this.spinner.rotation.y += spin * delta;
    if (this.inner) this.inner.rotation.x -= spin * 1.4 * delta;
    const breath = 1 + 0.02 * Math.sin(time * 0.9 + this.phase);
    const grow = (0.6 + 0.4 * p) * (1 + this.tier.lift * this.hover + this.tier.lift * 0.8 * this.focus) * breath;
    this.spinner.scale.setScalar(this.radius * grow);
    const glow = Math.min(1, (this.tier.glow + 0.35 * a) * (0.12 + 0.88 * p));
    this.wire.material.opacity = glow;
    if (this.inner) this.inner.material.opacity = glow * 0.7;
    this.fill.material.opacity = (0.7 + 0.15 * a) * (0.15 + 0.85 * p);
    this.aura.scale.setScalar(this.radius * (2.4 + 0.8 * a));
    const base = this.tier.aura || this.active ? 0.22 : 0;
    this.aura.material.uniforms.uStrength.value = (base + 0.3 * a + HEARTBEAT.aura * this.beat) * p;
    if (this.ring) {
      this.ring.scale.setScalar(grow / (0.6 + 0.4 * p) * (1 + 0.04 * this.beat));
      const opacity = Math.min(1, (UNION_RING.opacity + 0.25 * a + HEARTBEAT.ring * this.beat) * (0.1 + 0.9 * p));
      for (const child of this.ring.children) ((child as Mesh).material as MeshBasicMaterial).opacity = opacity;
    }
  }
}

/** Anillo plano por segmentos (uno por color, con un pequeño hueco entre ellos), de cara a la cámara. */
function createRing(colors: readonly string[], radius: number): Group {
  const ring = new Group();
  const n = colors.length;
  const gap = n > 1 ? UNION_RING.gap : 0;
  const arc = (Math.PI * 2) / n;
  colors.forEach((color, i) => {
    const geometry = new RingGeometry(UNION_RING.inner * radius, UNION_RING.outer * radius, Math.max(8, Math.ceil(48 / n)), 1, Math.PI / 2 + i * arc + gap / 2, arc - gap);
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: new Color(color).lerp(new Color('#ffffff'), 0.15),
        transparent: true,
        opacity: UNION_RING.opacity,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    mesh.renderOrder = 6;
    mesh.name = `ring-segment:${i}`;
    ring.add(mesh);
  });
  return ring;
}
