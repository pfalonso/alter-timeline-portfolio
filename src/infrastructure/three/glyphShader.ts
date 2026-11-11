/**
 * Glifos procedurales de los nodos (SDF en el fragment shader, nítidos a cualquier zoom).
 *
 * - Peso (`uTier`): 3 = glifo compuesto (forma + anillo exterior + marca interior + aura de
 *   pigmento); 2 = forma sola con contorno y relleno suave; 1 = marca pequeña sin aura.
 * - Lenguaje de forma (`uStyle`): 0 geométrico (rombo, hexágono, marcos con esquinas y trazos de
 *   circuito), 1 orgánico (manchas de acuarela, pétalo, trazo de pincel, espiral), 2 neutro (círculo
 *   y anillos).
 *
 * Coordenadas: `q` en unidades del radio del nodo (la forma principal mide ~1).
 */
export const GLYPH_VERTEX = /* glsl */ `
  uniform float uExtent;
  varying vec2 vQ;
  void main() {
    vQ = (uv * 2.0 - 1.0) * uExtent;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const GLYPH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPaper;
  uniform float uStyle;
  uniform float uTier;
  uniform float uPresence;
  uniform float uAttention;
  uniform float uTime;
  uniform float uSeed;
  uniform float uExtent;
  varying vec2 vQ;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
  float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  float sdHex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a; vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  float aa(float d) { float w = max(fwidth(d), 1e-4); return 1.0 - smoothstep(-w, w, d); }
  float stroke(float d, float t) { return aa(abs(d) - t); }

  // Acumula capa sobre capa (mezcla "over").
  vec4 over(vec4 base, vec3 color, float alpha) {
    float a = alpha + base.a * (1.0 - alpha);
    vec3 c = (color * alpha + base.rgb * base.a * (1.0 - alpha)) / max(a, 1e-4);
    return vec4(c, a);
  }

  vec4 geometric(vec2 q, float tier, vec3 ink, vec3 soft) {
    vec4 o = vec4(0.0);
    if (tier < 1.5) {
      float d = sdBox(rot(0.785398) * q, vec2(0.62));
      return over(o, ink, aa(d));
    }
    if (tier < 2.5) {
      float d = sdHex(rot(0.5236) * q, 0.92);
      o = over(o, soft, aa(d) * 0.88);
      return over(o, ink, stroke(d, 0.1));
    }
    // Mayor: rombo con contorno, marco de esquinas, marca interior y trazos de circuito.
    float d = sdBox(rot(0.785398) * q, vec2(0.78));
    o = over(o, soft, aa(d) * 0.9);
    o = over(o, ink, stroke(d, 0.09));
    float frame = sdBox(q, vec2(1.62));
    float corners = step(1.05, min(abs(q.x), abs(q.y)));
    o = over(o, ink, stroke(frame, 0.065) * corners);
    o = over(o, ink, aa(sdBox(q, vec2(0.2))));
    float traces = min(min(sdSegment(q, vec2(1.62, 0.55), vec2(2.55, 0.55)), sdSegment(q, vec2(-1.62, -0.55), vec2(-2.55, -0.55))),
      min(sdSegment(q, vec2(0.55, 1.62), vec2(0.55, 2.3)), sdSegment(q, vec2(-0.55, -1.62), vec2(-0.55, -2.3))));
    o = over(o, ink, stroke(traces, 0.045) * 0.85);
    float pads = min(min(length(q - vec2(2.6, 0.55)), length(q - vec2(-2.6, -0.55))), min(length(q - vec2(0.55, 2.35)), length(q - vec2(-0.55, -2.35))));
    o = over(o, ink, aa(pads - 0.12));
    return o;
  }

  vec4 organic(vec2 q, float tier, vec3 ink, vec3 soft) {
    vec4 o = vec4(0.0);
    float t = uTime * 0.25;
    float wob = noise(q * 2.2 + uSeed + t) - 0.5;
    if (tier < 1.5) {
      float d = length(q * vec2(1.0, 1.18)) - 0.7 + 0.16 * wob;
      float rim = smoothstep(-0.35, 0.0, d);
      return over(o, mix(soft, ink, 0.55 + 0.45 * rim), aa(d));
    }
    if (tier < 2.5) {
      // Pétalo / gota: se estrecha hacia la punta, girado según la semilla.
      vec2 p = rot(fract(uSeed * 0.37) * 1.4 - 0.7) * q;
      float r = 0.98 - 0.42 * smoothstep(-0.3, 1.1, p.y);
      float d = length(vec2(p.x, p.y + 0.12)) - r + 0.12 * wob;
      float rim = smoothstep(-0.32, 0.0, d);
      o = over(o, mix(soft, ink, rim * 0.6), aa(d) * (0.78 + 0.2 * rim));
      float brush = 0.06 + 0.07 * noise(vec2(atan(p.y, p.x) * 2.0, uSeed));
      return over(o, ink, stroke(d, brush) * 0.9);
    }
    // Mayor: mancha de acuarela con borde acumulado, trazo de pincel abierto y espiral interior.
    float d = length(q) - 1.08 + 0.26 * wob + 0.1 * (noise(q * 5.0 - uSeed) - 0.5);
    float rim = smoothstep(-0.4, 0.0, d);
    float gran = noise(q * 9.0 + uSeed);
    o = over(o, mix(soft, ink, 0.25 + 0.6 * rim), aa(d) * (0.72 + 0.25 * rim) * (0.85 + 0.15 * gran));
    float a = atan(q.y, q.x);
    float ringR = 1.85 + 0.12 * (noise(vec2(a * 1.5, uSeed)) - 0.5);
    float sweep = fract((a + 3.14159) / 6.28318 + uSeed * 0.13);
    float taper = smoothstep(0.0, 0.18, sweep) * (1.0 - smoothstep(0.72, 0.86, sweep));
    o = over(o, ink, stroke(length(q) - ringR, 0.03 + 0.1 * taper) * step(0.01, taper) * 0.9);
    float r = length(q);
    float b = 0.085;
    float k = floor((r / b - (a + 3.14159)) / 6.28318 + 0.5);
    float sd = abs(r - b * (a + 3.14159 + 6.28318 * k));
    o = over(o, uPaper * 0.6 + ink * 0.25, stroke(sd, 0.035) * (1.0 - smoothstep(0.5, 0.62, r)));
    return o;
  }

  vec4 neutral(vec2 q, float tier, vec3 ink, vec3 soft) {
    vec4 o = vec4(0.0);
    float r = length(q);
    if (tier < 1.5) return over(o, ink, aa(r - 0.62));
    if (tier < 2.5) {
      o = over(o, soft, aa(r - 0.92) * 0.88);
      return over(o, ink, stroke(r - 0.92, 0.1));
    }
    o = over(o, soft, aa(r - 0.95) * 0.9);
    o = over(o, ink, stroke(r - 0.95, 0.09));
    o = over(o, ink, stroke(r - 1.55, 0.06));
    o = over(o, ink, stroke(r - 2.05, 0.03) * 0.6);
    return over(o, uPaper, aa(r - 0.22));
  }

  void main() {
    vec2 q = vQ;
    float tier = uTier;
    vec3 ink = mix(uColor, vec3(1.0), 0.12);
    vec3 soft = mix(uPaper, uColor, 0.5);
    vec4 glyph = uStyle < 0.5 ? geometric(q, tier, ink, soft) : uStyle < 1.5 ? organic(q, tier, ink, soft) : neutral(q, tier, ink, soft);

    // Aura de pigmento (solo el mayor en reposo; todos al señalarlos): se expande con la atención.
    float auraBase = tier > 2.5 ? 0.3 : 0.0;
    float aura = auraBase + 0.32 * uAttention;
    float spread = (tier > 2.5 ? 1.9 : 1.0) * (1.0 + 0.4 * uAttention);
    float n = noise(q * 1.3 + uSeed + uTime * 0.06);
    float cloud = exp(-pow(length(q) / spread, 2.0) * (1.6 - 0.8 * n));
    // El aura se apaga antes del borde del cuadro (nunca se ve su silueta).
    float edge = 1.0 - smoothstep(uExtent * 0.55, uExtent * 0.95, length(q));
    vec4 o = vec4(uColor * 0.9, cloud * aura * (0.6 + 0.4 * n) * edge);
    o = over(o, glyph.rgb, glyph.a);
    gl_FragColor = vec4(o.rgb, o.a * uPresence);
  }
`;
