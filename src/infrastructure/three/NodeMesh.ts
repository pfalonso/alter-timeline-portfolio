import { Color, Group, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type BufferGeometry, type Texture } from 'three';
import type { LineStyle } from '../../domain/model';
import type { Vec3 } from '../../domain/services';
import { GLYPH_FRAGMENT, GLYPH_VERTEX } from './glyphShader';
import { damp } from './math';
import type { FrameContext } from './types';

export interface NodeSpec {
  readonly eventId: string;
  readonly position: Vec3;
  readonly color: string;
  /** Colores de las categorías secundarias (ya no se dibujan; se conservan por compatibilidad). */
  readonly secondaryColors?: readonly string[];
  readonly importance: 1 | 2 | 3;
  /** Lenguaje de forma de la línea a la que pertenece (por defecto, neutro). */
  readonly style?: LineStyle;
  /** Desfase para que los nodos no respiren al unísono (y semilla de la forma orgánica). */
  readonly phase: number;
}

/** Recursos compartidos por todos los nodos: el cuadro del glifo y la textura de anillo del pulso. */
export class NodeAssets {
  readonly quad: BufferGeometry = new PlaneGeometry(2, 2);

  constructor(readonly ring: Texture) {}

  dispose(): void {
    this.quad.dispose();
    this.ring.dispose();
  }
}

/** Jerarquía: mayor = glifo grande; medio = forma mediana; menor = marca pequeña. */
export const NODE_RADIUS: Record<1 | 2 | 3, number> = { 1: 0.2, 2: 0.42, 3: 0.7 };

/** Cómo se presenta cada peso. */
export interface NodeTier {
  /** Media anchura del cuadro del glifo, en radios (deja sitio al aura y a los trazos exteriores). */
  readonly extent: number;
  /** Aura de pigmento en reposo. */
  readonly aura: boolean;
  /** Cuánto crece el glifo al señalarlo (los menores, más: si no, cuesta ver dónde está el cursor). */
  readonly lift: number;
}

export const NODE_TIERS: Record<1 | 2 | 3, NodeTier> = {
  1: { extent: 2.2, aura: false, lift: 0.9 },
  2: { extent: 2.6, aura: false, lift: 0.22 },
  3: { extent: 4.4, aura: true, lift: 0.16 },
};
export const STYLE_CODE: Record<LineStyle, number> = { geometric: 0, organic: 1, neutral: 2 };
/** Presencia de un nodo filtrado: se atenúa, no desaparece. */
export const DIMMED_PRESENCE = 0.1;
/** Duración del deslizamiento de un nodo tras cambiar los filtros. */
export const SLIDE_SECONDS = 0.75;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Color del papel (para rellenos suaves y marcas interiores). */
export const GLYPH_PAPER = '#171029';

/** Un evento en la escena: glifo procedural que mira a la cámara; su pigmento se expande al señalarlo. */
export class NodeMesh {
  readonly group = new Group();
  readonly eventId: string;
  readonly radius: number;
  readonly importance: 1 | 2 | 3;
  readonly color: string;
  readonly style: LineStyle;
  readonly glyph: Mesh<BufferGeometry, ShaderMaterial>;

  private presenceValue = 1;
  private presenceTarget = 1;
  private hover = 0;
  private hoverTarget = 0;
  private focus = 0;
  private focusTarget = 0;
  private readonly material: ShaderMaterial;
  private readonly tier: NodeTier;
  private readonly phase: number;
  /** Deslizamiento tras un re-layout: de `slide.from` a la posición final, en `SLIDE_SECONDS`. */
  private slide: { readonly from: Vec3; readonly to: Vec3; t: number } | null = null;

  constructor(spec: NodeSpec, assets: NodeAssets) {
    this.eventId = spec.eventId;
    this.importance = spec.importance;
    this.radius = NODE_RADIUS[spec.importance];
    this.color = spec.color;
    this.style = spec.style ?? 'neutral';
    this.phase = spec.phase;
    this.tier = NODE_TIERS[spec.importance];
    this.group.name = `node:${spec.eventId}`;
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);

    this.material = new ShaderMaterial({
      vertexShader: GLYPH_VERTEX,
      fragmentShader: GLYPH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        uColor: { value: new Color(spec.color) },
        uPaper: { value: new Color(GLYPH_PAPER) },
        uStyle: { value: STYLE_CODE[this.style] },
        uTier: { value: spec.importance },
        uExtent: { value: this.tier.extent },
        uPresence: { value: 1 },
        uAttention: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: spec.phase % 97 },
      },
    });
    this.glyph = new Mesh(assets.quad, this.material);
    this.glyph.name = `glyph:${spec.eventId}`;
    // Después de las líneas: el relleno del glifo las tapa al pasar por el nodo.
    this.glyph.renderOrder = 5;
    this.group.add(this.glyph);
    this.apply(0);
  }

  /** 0 (atenuado) … 1 (visible), ya interpolado. */
  get presence(): number {
    return this.presenceValue;
  }

  get highlighted(): boolean {
    return this.hoverTarget > 0 || this.focusTarget > 0;
  }

  /** Escala actual del glifo respecto a su tamaño en reposo (para el radio aparente). */
  get scale(): number {
    return this.glyph.scale.x / (this.radius * this.tier.extent);
  }

  /** Atención actual (0..1): cuánto se ha expandido el pigmento por hover/foco. */
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
    // El glifo siempre mira a la cámara.
    this.glyph.quaternion.copy(frame.camera.quaternion);
    this.apply(frame.reducedMotion ? 0 : frame.time);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.material.dispose();
  }

  private apply(time: number): void {
    const p = this.presenceValue;
    const breath = 1 + 0.025 * Math.sin(time * 0.9 + this.phase);
    const grow = (0.6 + 0.4 * p) * (1 + this.tier.lift * this.hover + this.tier.lift * 0.8 * this.focus) * breath;
    this.glyph.scale.setScalar(this.radius * this.tier.extent * grow);
    const uniforms = this.material.uniforms;
    uniforms.uPresence.value = 0.12 + 0.88 * p;
    uniforms.uAttention.value = this.attention;
    uniforms.uTime.value = time + this.phase;
  }
}
