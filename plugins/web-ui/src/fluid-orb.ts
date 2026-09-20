const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.22;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * 0.8 * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 dark = u_color;

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`;

export function rgbFor(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return [0.98, 0.45, 0.09];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function stillFrame(color: string): string {
  return `radial-gradient(circle at 34% 28%, #ffffff 0%, ${color} 62%, ${color} 100%)`;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export class FluidOrb extends HTMLElement {
  private frame = 0;
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private uniforms: { time: WebGLUniformLocation | null; resolution: WebGLUniformLocation | null } | null = null;
  private start = 0;

  connectedCallback(): void {
    const size = Number(this.getAttribute("size") ?? 132);
    const color = this.getAttribute("color") || "#f97316";
    this.style.width = `${size}px`;
    this.style.height = `${size}px`;
    this.setAttribute("aria-hidden", "true");
    this.style.borderRadius = "50%";
    this.style.display = "block";
    this.style.background = stillFrame(color);

    const reduced = this.matchesReducedMotion();
    const canvas = this.ownerDocument.createElement("canvas");
    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.borderRadius = "50%";
    const gl = canvas.getContext?.("webgl", { antialias: true, alpha: true }) as WebGLRenderingContext | null;
    if (!gl) return;

    const program = gl.createProgram();
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vert || !frag) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(program, "u_color"), ...rgbFor(color));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.canvas = canvas;
    this.gl = gl;
    this.uniforms = { time: gl.getUniformLocation(program, "u_time"), resolution: gl.getUniformLocation(program, "u_resolution") };
    this.style.background = "transparent";
    this.replaceChildren(canvas);
    this.start = Date.now();
    this.draw(0);
    if (!reduced) this.loop();
  }

  disconnectedCallback(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private matchesReducedMotion(): boolean {
    return this.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  private draw(seconds: number): void {
    const { gl, canvas, uniforms } = this;
    if (!gl || !canvas || !uniforms) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private loop(): void {
    const view = this.ownerDocument.defaultView;
    if (!view) return;
    const step = (): void => {
      if (!this.isConnected) return;
      if (!this.ownerDocument.hidden) this.draw((Date.now() - this.start) / 1000);
      this.frame = view.requestAnimationFrame(step);
    };
    this.frame = view.requestAnimationFrame(step);
  }
}

export function defineFluidOrb(): void {
  if (typeof customElements === "undefined" || customElements.get("fluid-orb")) return;
  customElements.define("fluid-orb", FluidOrb);
}
