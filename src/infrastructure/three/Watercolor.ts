import { Color, HalfFloatType, LinearFilter, ShaderMaterial, Vector2, WebGLRenderTarget, type Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Vec3 } from '../../domain/services';
import { damp, valueAtX } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

/** Nº máximo de pigmentos (uno por línea vital). */
export const MAX_PIGMENTS = 6;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const NOISE = /* glsl */ `
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
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + vec2(13.1, 7.7); a *= 0.5; }
    return v;
  }
`;

/**
 * Lavados de pigmento (a resolución reducida): domain warping con fbm que fluye muy despacio,
 * bordes de pigmento acumulado (edge darkening), sangrados entre colores y un tinte hacia el color
 * de la línea en foco. En alfa se guarda la densidad de pigmento para la granulación.
 */
export const WASH_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOffset;
  uniform float uAspect;
  uniform vec3 uPaper;
  uniform vec3 uColors[${MAX_PIGMENTS}];
  uniform float uCount;
  uniform vec3 uFocusColor;
  uniform float uFocusAmount;
  uniform float uStrength;
  varying vec2 vUv;
  ${NOISE}

  vec3 palette(float h) {
    float x = clamp(h, 0.0, 1.0) * max(uCount - 1.0, 0.0);
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < ${MAX_PIGMENTS}; i++) {
      float fi = float(i);
      float w = max(0.0, 1.0 - abs(x - fi)) * step(fi, uCount - 1.0);
      sum += uColors[i] * w;
      total += w;
    }
    return total > 0.0 ? sum / total : uFocusColor;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.3 + uOffset;
    float t = uTime * 0.016;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.7));
    vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.5), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.4));
    float f = fbm(p + 3.4 * r);
    float hue = fbm(p * 0.55 + 1.8 * r + vec2(11.0, 3.0) + t * 0.3);
    vec3 pigment = palette(smoothstep(0.25, 0.75, hue));
    pigment = mix(pigment, uFocusColor, uFocusAmount * (0.35 + 0.45 * smoothstep(0.35, 0.75, q.x)));

    // Lavado + borde de pigmento acumulado donde el agua se secó + un segundo sangrado.
    float wash = smoothstep(0.43, 0.63, f);
    float rim = smoothstep(0.40, 0.455, f) * (1.0 - smoothstep(0.455, 0.56, f));
    float bleed = smoothstep(0.52, 0.8, fbm(p * 1.7 + 4.0 * q - t));
    float density = clamp(wash * 0.55 + rim * 0.7 + bleed * 0.3, 0.0, 1.0);

    // Viñeta suave: el centro (la banda de nodos) queda algo más limpio para que se lea la historia.
    float band = 1.0 - 0.45 * exp(-pow((vUv.y - 0.5) * 3.2, 2.0));
    float vignette = smoothstep(1.05, 0.2, length((vUv - 0.5) * vec2(1.3, 1.7)));
    vec3 color = uPaper * (0.82 + 0.3 * vignette) + pigment * density * uStrength * band * (0.35 + 0.65 * vignette);
    gl_FragColor = vec4(color, density);
  }
`;

/** Composición a resolución completa: escala el lavado y añade granulación y textura de papel. */
export const PAPER_FRAGMENT = /* glsl */ `
  uniform sampler2D tWash;
  uniform vec3 uPaper;
  uniform float uGrain;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec4 wash = texture2D(tWash, vUv);
    vec2 px = gl_FragCoord.xy;
    // Granulación: el pigmento se posa en los poros del papel (solo donde hay pigmento).
    float gran = noise(px * 0.45) * 0.6 + noise(px * 1.3) * 0.4;
    // Fibras: ruido alargado en una dirección + grano fino.
    float fiber = noise(vec2(px.x * 0.035, px.y * 0.5)) * 0.5 + hash(px) * 0.5;
    vec3 color = wash.rgb * (1.0 + (gran - 0.5) * 0.9 * wash.a * uGrain);
    color += uPaper * (fiber - 0.5) * 0.35 * uGrain;
    gl_FragColor = vec4(max(color, 0.0), 1.0);
  }
`;

export interface PigmentLine {
  readonly color: string;
  readonly points: readonly Vec3[];
  readonly focus: readonly number[];
  readonly main: boolean;
}

export interface WatercolorOptions {
  readonly paper: string;
  /** Intensidad del pigmento sobre el papel. */
  readonly strength: number;
  /** Desplazamiento del dibujo por unidad de mundo que se mueve la cámara (parallax leve). */
  readonly parallax: number;
}

export const DEFAULT_WATERCOLOR: WatercolorOptions = { paper: '#140e26', strength: 0.13, parallax: 0.0035 };

/**
 * Fondo de acuarela en movimiento. Es un `SceneEffect` (se actualiza con cada fotograma: tiempo,
 * parallax con la cámara y tinte hacia la línea en foco en la X que mira la cámara), pero no añade
 * nada a la escena: lo dibuja `WatercolorPass` antes que ella.
 */
export class WatercolorWash implements SceneEffect {
  readonly material: ShaderMaterial;
  private readonly lines: readonly PigmentLine[];
  private focusAmount = 0;
  private readonly focusColor = new Color();
  private readonly target = new Color();

  constructor(
    lines: readonly PigmentLine[],
    private readonly options: WatercolorOptions = DEFAULT_WATERCOLOR,
  ) {
    this.lines = lines.slice(0, MAX_PIGMENTS);
    const colors = Array.from({ length: MAX_PIGMENTS }, (_, i) => new Color(this.lines[i]?.color ?? options.paper));
    const main = this.lines.find((line) => line.main) ?? this.lines[0];
    this.focusColor.set(main?.color ?? options.paper);
    this.material = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: WASH_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uOffset: { value: new Vector2() },
        uAspect: { value: 1 },
        uPaper: { value: new Color(options.paper) },
        uColors: { value: colors },
        uCount: { value: Math.max(1, this.lines.length) },
        uFocusColor: { value: this.focusColor },
        uFocusAmount: { value: 0 },
        uStrength: { value: options.strength },
      },
    });
  }

  /** Línea con más foco en una X (la central gana los empates) y su intensidad. */
  focusAt(x: number): { color: string; amount: number } | null {
    let best: { color: string; amount: number } | null = null;
    for (const line of this.lines) {
      const first = line.points[0];
      const last = line.points[line.points.length - 1];
      if (!first || x < first.x || x > last.x) continue;
      const amount = valueAtX(line.points, line.focus, x) + (line.main ? 0.01 : 0);
      if (!best || amount > best.amount) best = { color: line.color, amount };
    }
    return best;
  }

  attach(_scene: Scene): void {
    // Nada que añadir: lo dibuja WatercolorPass.
  }

  update(frame: FrameContext): void {
    const uniforms = this.material.uniforms;
    const { x, y } = frame.camera.position;
    uniforms.uTime.value = frame.reducedMotion ? 0 : frame.time;
    uniforms.uOffset.value.set(x * this.options.parallax, y * this.options.parallax);
    uniforms.uAspect.value = frame.viewport.width / Math.max(1, frame.viewport.height);
    const focus = this.focusAt(x);
    if (focus) this.target.set(focus.color);
    const amount = focus ? Math.min(1, focus.amount) * 0.85 : 0;
    if (frame.reducedMotion) {
      this.focusColor.copy(this.target);
      this.focusAmount = amount;
    } else {
      this.focusColor.lerp(this.target, 1 - Math.exp(-1.5 * frame.delta));
      this.focusAmount = damp(this.focusAmount, amount, 1.5, frame.delta);
    }
    uniforms.uFocusAmount.value = this.focusAmount;
  }

  dispose(): void {
    this.material.dispose();
  }
}

/**
 * Pase de fondo: dibuja el lavado a resolución reducida (`scale`) y lo compone a pantalla completa
 * con la granulación y el papel. Sin lavado, pinta el papel liso. Va antes del `RenderPass` (que
 * entonces no borra el color).
 */
export class WatercolorPass extends Pass {
  private wash: WatercolorWash | null = null;
  private readonly target: WebGLRenderTarget;
  private readonly washQuad = new FullScreenQuad();
  private readonly paperQuad: FullScreenQuad;
  private readonly paperMaterial: ShaderMaterial;

  constructor(
    private readonly scale = 0.5,
    paper: string = DEFAULT_WATERCOLOR.paper,
  ) {
    super();
    this.needsSwap = false;
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.paperMaterial = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: PAPER_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { tWash: { value: this.target.texture }, uPaper: { value: new Color(paper) }, uGrain: { value: 1 } },
    });
    this.paperQuad = new FullScreenQuad(this.paperMaterial);
  }

  setWash(wash: WatercolorWash | null): void {
    this.wash = wash;
    this.washQuad.material = wash?.material ?? this.paperMaterial;
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  override render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    if (this.wash) {
      renderer.setRenderTarget(this.target);
      this.washQuad.render(renderer);
      this.paperMaterial.uniforms.uGrain.value = 1;
    } else {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(this.paperMaterial.uniforms.uPaper.value as Color, 1);
      renderer.clear();
      this.paperMaterial.uniforms.uGrain.value = 0;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.paperQuad.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.paperMaterial.dispose();
    this.washQuad.dispose();
    this.paperQuad.dispose();
  }
}
