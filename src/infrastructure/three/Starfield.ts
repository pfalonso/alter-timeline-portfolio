import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';
import { createRandom } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface StarLayer {
  readonly count: number;
  /** Caja en la que se reparten los puntos. */
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
  readonly size: readonly [number, number];
  readonly alpha: readonly [number, number];
  readonly palette: readonly string[];
  /** Amplitud de la deriva lenta (0 = fijas). */
  readonly drift: number;
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uScale;
  uniform float uTime;
  uniform float uDrift;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.13 + aPhase) * uDrift;
    p.x += cos(uTime * 0.09 + aPhase * 1.7) * uDrift;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float twinkle = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase) * 1.6) + aPhase * 6.0);
    vAlpha = aAlpha * twinkle;
    vColor = aColor;
    gl_PointSize = max(1.0, aSize * uScale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 1.8);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/**
 * Campo de estrellas y polvo en varias capas de profundidad. El parallax sale gratis de la
 * perspectiva: al viajar por el tiempo, las capas cercanas se mueven más que las lejanas.
 */
export class Starfield implements SceneEffect {
  readonly layers: Points<BufferGeometry, ShaderMaterial>[];

  constructor(layers: readonly StarLayer[], seed = 42) {
    const random = createRandom(seed);
    const between = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * random();
    this.layers = layers.map((layer, index) => {
      const positions = new Float32Array(layer.count * 3);
      const colors = new Float32Array(layer.count * 3);
      const sizes = new Float32Array(layer.count);
      const alphas = new Float32Array(layer.count);
      const phases = new Float32Array(layer.count);
      const palette = layer.palette.map((hex) => new Color(hex));
      for (let i = 0; i < layer.count; i += 1) {
        positions[i * 3] = between(layer.x);
        positions[i * 3 + 1] = between(layer.y);
        positions[i * 3 + 2] = between(layer.z);
        const color = palette[Math.floor(random() * palette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        // Muchas pequeñas, pocas grandes.
        sizes[i] = layer.size[0] + (layer.size[1] - layer.size[0]) * Math.pow(random(), 3);
        alphas[i] = between(layer.alpha);
        phases[i] = random() * 20;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
      geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
      geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));
      geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
      const points = new Points(
        geometry,
        new ShaderMaterial({
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { uScale: { value: 600 }, uTime: { value: 0 }, uDrift: { value: layer.drift } },
        }),
      );
      points.name = `starfield:${index}`;
      points.frustumCulled = false;
      return points;
    });
  }

  attach(scene: Scene): void {
    for (const layer of this.layers) scene.add(layer);
  }

  update(frame: FrameContext): void {
    for (const layer of this.layers) {
      layer.material.uniforms.uScale.value = frame.viewport.height * 0.9;
      layer.material.uniforms.uTime.value = frame.reducedMotion ? 0 : frame.time;
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.removeFromParent();
      layer.geometry.dispose();
      layer.material.dispose();
    }
  }
}
