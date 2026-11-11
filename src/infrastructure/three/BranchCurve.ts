import {
  AdditiveBlending,
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Vec3 } from '../../domain/services';
import { damp, PathTable, valueAtX } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface BranchStyle {
  readonly color: string;
  /** Color al final de la curva (degradado a lo largo); sin él, color uniforme. */
  readonly colorEnd?: string;
  readonly radius: number;
  readonly intensity: number;
  /** Fracción inicial en la que el filamento aparece. */
  readonly fadeIn: number;
  /** Fracción final en la que se desvanece (0 = no se desvanece). */
  readonly fadeOut: number;
  /** Velocidad del pulso de energía que recorre la rama. */
  readonly flowSpeed: number;
  readonly fogDensity: number;
  /** Intensidad de foco (0..1) en cada punto; sin ella, 1 en toda la curva. */
  readonly focus?: readonly number[];
  /** Factor de grosor en cada punto (1 = `radius`); sin él, grosor constante. */
  readonly widths?: readonly number[];
}

/** Realce de una línea desde la leyenda: neutro, resaltada o atenuada (porque se resalta otra). */
export type BranchEmphasis = 'none' | 'on' | 'off';
const EMPHASIS_VALUE: Readonly<Record<BranchEmphasis, number>> = { none: 1, on: 1.7, off: 0.28 };

const VERTEX = /* glsl */ `
  attribute float aFocus;
  attribute float aWidth;
  uniform float uRadius;
  varying vec2 vUv;
  varying float vDepth;
  varying float vRim;
  varying float vFocus;
  void main() {
    vUv = uv;
    vFocus = aFocus;
    // La normal del tubo es radial: ensanchar es desplazar el vértice a lo largo de ella.
    vec3 p = position + normal * uRadius * (aWidth - 1.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vec3 n = normalize(normalMatrix * normal);
    vRim = abs(n.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColorEnd;
  uniform float uTime;
  uniform float uLength;
  uniform float uIntensity;
  uniform float uFadeIn;
  uniform float uFadeOut;
  uniform float uFlowSpeed;
  uniform float uFogDensity;
  uniform float uEmphasis;
  varying vec2 vUv;
  varying float vDepth;
  varying float vRim;
  varying float vFocus;
  void main() {
    float along = vUv.x * uLength;
    // Pulsos de energía que viajan hacia el futuro, a dos escalas.
    float a = fract(along * 0.085 - uTime * uFlowSpeed);
    float b = fract(along * 0.31 - uTime * uFlowSpeed * 1.9 + 0.37);
    float pulse = smoothstep(0.0, 0.1, a) * (1.0 - smoothstep(0.1, 0.75, a));
    float ripple = smoothstep(0.0, 0.2, b) * (1.0 - smoothstep(0.2, 0.9, b));
    float edge = smoothstep(0.0, uFadeIn, vUv.x);
    if (uFadeOut > 0.0) edge *= 1.0 - smoothstep(1.0 - uFadeOut, 1.0, vUv.x);
    float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
    float core = 0.45 + 0.55 * vRim;
    vec3 base = mix(uColor, uColorEnd, smoothstep(0.15, 0.85, vUv.x));
    vec3 color = base * (0.3 + 0.85 * pulse + 0.2 * ripple) + vec3(0.25) * pulse * pulse;
    // De cerca el filamento se suaviza para no quemar la imagen.
    float near = mix(0.5, 1.0, smoothstep(14.0, 46.0, vDepth));
    // Foco: fuera de foco la línea sigue ahí, pero tenue (brillo y opacidad bajan juntos).
    float focus = vFocus * uEmphasis;
    gl_FragColor = vec4(color * uIntensity * core * near * focus, edge * fog * mix(0.55, 1.0, min(1.0, vFocus)));
  }
`;

/** Una rama (o un tramo de duración) como filamento de luz con energía que fluye por él. */
export class BranchCurve implements SceneEffect {
  readonly mesh: Mesh<TubeGeometry, ShaderMaterial>;
  readonly path: PathTable;
  private readonly material: ShaderMaterial;
  private emphasis = 1;
  private emphasisTarget = 1;

  constructor(
    readonly id: string,
    points: readonly Vec3[],
    style: BranchStyle,
  ) {
    this.path = new PathTable(points, Math.max(8, points.length * 2));
    const curve = new CatmullRomCurve3(
      points.map((point) => new Vector3(point.x, point.y, point.z)),
      false,
      'centripetal',
    );
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(style.color) },
        uColorEnd: { value: new Color(style.colorEnd ?? style.color) },
        uTime: { value: 0 },
        uLength: { value: this.path.length },
        uIntensity: { value: style.intensity },
        uFadeIn: { value: Math.max(0.0001, style.fadeIn) },
        uFadeOut: { value: style.fadeOut },
        uFlowSpeed: { value: style.flowSpeed },
        uFogDensity: { value: style.fogDensity },
        uRadius: { value: style.radius },
        uEmphasis: { value: 1 },
      },
    });
    const segments = Math.max(8, points.length * 2);
    const radial = 6;
    const geometry = new TubeGeometry(curve, segments, style.radius, radial, false);
    // Un valor de foco y de grosor por anillo del tubo, leído en la X de su centro.
    const focus = new Float32Array((segments + 1) * (radial + 1));
    const width = new Float32Array(focus.length);
    const center = new Vector3();
    for (let i = 0; i <= segments; i += 1) {
      curve.getPointAt(i / segments, center);
      const f = valueAtX(points, style.focus, center.x);
      const w = valueAtX(points, style.widths, center.x);
      for (let j = 0; j <= radial; j += 1) {
        focus[i * (radial + 1) + j] = f;
        width[i * (radial + 1) + j] = w;
      }
    }
    geometry.setAttribute('aFocus', new BufferAttribute(focus, 1));
    geometry.setAttribute('aWidth', new BufferAttribute(width, 1));
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = `branch:${id}`;
    this.mesh.frustumCulled = false;
  }

  attach(scene: Scene): void {
    scene.add(this.mesh);
  }

  /** Resalta o atenúa la línea (leyenda). La transición es suave salvo con movimiento reducido. */
  setEmphasis(emphasis: BranchEmphasis): void {
    this.emphasisTarget = EMPHASIS_VALUE[emphasis];
  }

  /** Realce actual (1 = neutro). */
  get currentEmphasis(): number {
    return this.emphasis;
  }

  update(frame: FrameContext): void {
    this.material.uniforms.uTime.value = frame.reducedMotion ? 0 : frame.time;
    this.emphasis = frame.reducedMotion ? this.emphasisTarget : damp(this.emphasis, this.emphasisTarget, 8, frame.delta);
    this.material.uniforms.uEmphasis.value = this.emphasis;
    if (frame.fogDensity !== undefined) this.material.uniforms.uFogDensity.value = frame.fogDensity;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
