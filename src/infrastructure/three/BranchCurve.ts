import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Vec3 } from '../../domain/services';
import { PathTable } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface BranchStyle {
  readonly color: string;
  readonly radius: number;
  readonly intensity: number;
  /** Fracción inicial en la que el filamento aparece. */
  readonly fadeIn: number;
  /** Fracción final en la que se desvanece (0 = no se desvanece). */
  readonly fadeOut: number;
  /** Velocidad del pulso de energía que recorre la rama. */
  readonly flowSpeed: number;
  readonly fogDensity: number;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  varying float vRim;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    vec3 n = normalize(normalMatrix * normal);
    vRim = abs(n.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLength;
  uniform float uIntensity;
  uniform float uFadeIn;
  uniform float uFadeOut;
  uniform float uFlowSpeed;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vDepth;
  varying float vRim;
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
    vec3 color = uColor * (0.3 + 0.85 * pulse + 0.2 * ripple) + vec3(0.25) * pulse * pulse;
    // De cerca el filamento se suaviza para no quemar la imagen.
    float near = mix(0.5, 1.0, smoothstep(14.0, 46.0, vDepth));
    gl_FragColor = vec4(color * uIntensity * core * near, edge * fog);
  }
`;

/** Una rama (o un tramo de duración) como filamento de luz con energía que fluye por él. */
export class BranchCurve implements SceneEffect {
  readonly mesh: Mesh<TubeGeometry, ShaderMaterial>;
  readonly path: PathTable;
  private readonly material: ShaderMaterial;

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
        uTime: { value: 0 },
        uLength: { value: this.path.length },
        uIntensity: { value: style.intensity },
        uFadeIn: { value: Math.max(0.0001, style.fadeIn) },
        uFadeOut: { value: style.fadeOut },
        uFlowSpeed: { value: style.flowSpeed },
        uFogDensity: { value: style.fogDensity },
      },
    });
    this.mesh = new Mesh(new TubeGeometry(curve, Math.max(8, points.length * 2), style.radius, 6, false), this.material);
    this.mesh.name = `branch:${id}`;
    this.mesh.frustumCulled = false;
  }

  attach(scene: Scene): void {
    scene.add(this.mesh);
  }

  update(frame: FrameContext): void {
    this.material.uniforms.uTime.value = frame.reducedMotion ? 0 : frame.time;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
