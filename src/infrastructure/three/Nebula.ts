import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Scene } from 'three';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOffset;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = vUv * vec2(9.0, 4.0) + uOffset;
    float t = uTime * 0.012;
    float warp = fbm(p + vec2(t, -t * 0.6));
    float cloud = fbm(p * 1.4 + warp * 1.8 + vec2(-t * 0.5, t));
    float veil = smoothstep(0.32, 0.85, cloud);
    float band = exp(-pow((vUv.y - 0.5 + (warp - 0.5) * 0.18) * 3.4, 2.0));
    vec3 color = mix(uColorA, uColorB, smoothstep(0.2, 0.8, warp));
    color = mix(color, uColorC, smoothstep(0.55, 0.95, cloud) * 0.6);
    float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    gl_FragColor = vec4(color * (veil * (0.35 + 0.65 * band)) * edge, 1.0);
  }
`;

/** Velo de nebulosa procedural al fondo; sigue a la cámara con retardo para dar profundidad. */
export class Nebula implements SceneEffect {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(
    colors: readonly [string, string, string] = ['#0a1438', '#0b3b4d', '#3a1a5c'],
    private readonly depth = -320,
    /** 1 = pegada a la cámara (infinitamente lejos); 0 = fija en el mundo. */
    private readonly follow = 0.9,
  ) {
    this.mesh = new Mesh(
      new PlaneGeometry(1500, 620),
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uOffset: { value: new Vector2() },
          uColorA: { value: new Color(colors[0]) },
          uColorB: { value: new Color(colors[1]) },
          uColorC: { value: new Color(colors[2]) },
        },
      }),
    );
    this.mesh.name = 'nebula';
    this.mesh.renderOrder = -10;
    this.mesh.position.z = depth;
    this.mesh.frustumCulled = false;
  }

  attach(scene: Scene): void {
    scene.add(this.mesh);
  }

  update(frame: FrameContext): void {
    const { x, y } = frame.camera.position;
    this.mesh.position.set(x * this.follow, y * this.follow, this.depth);
    const uniforms = this.mesh.material.uniforms;
    uniforms.uTime.value = frame.reducedMotion ? 0 : frame.time;
    // Compensa el seguimiento para que el dibujo de la nube no "patine" con la cámara.
    uniforms.uOffset.value.x = (x * this.follow) / 1500 * 9;
    uniforms.uOffset.value.y = (y * this.follow) / 620 * 4;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
