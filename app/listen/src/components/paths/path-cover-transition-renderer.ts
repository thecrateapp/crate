import { COVER_TEXTURE_SIZE } from "./path-cover-textures";

// TEST_GAP: shader output is not observable in jsdom (no WebGL2). The review Playwright spec
// checks the canvas is only shown while a transition runs; PathCoverStage tests mock this module.

const VERTEX = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

// Pixelate-blur: the cover coarsens into mip-averaged blocks softened by a blurred layer, the
// blocks flip to the next cover at the coarsest point (destination side first), then sharpen.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uT;
uniform float uDir;
uniform float uPeak;
uniform float uBlur;
uniform float uTexSize;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 soft(sampler2D tex, vec2 uv, float lod) {
  vec2 d = vec2(0.75 * exp2(lod) / uTexSize);
  return (textureLod(tex, uv, lod).rgb * 2.0
    + textureLod(tex, uv + vec2(d.x, d.y), lod).rgb
    + textureLod(tex, uv + vec2(-d.x, d.y), lod).rgb
    + textureLod(tex, uv + vec2(d.x, -d.y), lod).rgb
    + textureLod(tex, uv + vec2(-d.x, -d.y), lod).rgb) / 6.0;
}

void main() {
  float p = 1.0 - abs(2.0 * uT - 1.0);
  p = p * p * (3.0 - 2.0 * p);
  float cells = floor(exp(mix(log(uTexSize), log(uPeak), p)));
  vec2 q = (floor(vUv * cells) + 0.5) / cells;
  float lod = log2(uTexSize / cells);

  float edge = uDir > 0.0 ? 1.0 - q.x : q.x;
  float threshold = 0.5 + (edge - 0.5) * 0.22 + (hash(floor(q * uPeak)) - 0.5) * 0.1;
  float k = smoothstep(threshold - 0.03, threshold + 0.03, uT);

  vec3 blocky = mix(textureLod(uFrom, q, lod).rgb, textureLod(uTo, q, lod).rgb, k);
  vec3 blurred = mix(soft(uFrom, vUv, lod + 0.5), soft(uTo, vUv, lod + 0.5), k);
  outColor = vec4(mix(blocky, blurred, uBlur * p), 1.0);
}`;

export interface CoverTransition {
  from: ImageBitmap;
  to: ImageBitmap;
  dir: 1 | -1;
  peak: number;
  blur: number;
  startT: number;
  durationMs: number;
}
export type TransitionEnd = "done" | "cancelled";

interface Active {
  options: CoverTransition;
  start: number;
  t: number;
  resolve: (end: TransitionEnd) => void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  return shader;
}

/** One WebGL2 context per cover stage; frames run only while a transition is in flight. */
export class PathCoverTransitionRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private textures: WebGLTexture[] = [];
  private active: Active | null = null;
  private frame = 0;
  private lost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: { onLost: () => void; onRestored: () => void },
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    try {
      this.setup();
    } catch (error) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw error;
    }
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
  }

  get available() {
    return !this.lost;
  }

  /** Clock position of the running transition, or null at rest. */
  get progress(): number | null {
    return this.active?.t ?? null;
  }

  resize(width: number, height: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    if (this.active) this.draw(this.active.t);
  }

  run(options: CoverTransition): Promise<TransitionEnd> {
    this.cancel();
    if (this.lost) return Promise.resolve("cancelled");
    this.upload(this.textures[0]!, options.from);
    this.upload(this.textures[1]!, options.to);
    return new Promise((resolve) => {
      this.active = {
        options,
        start: performance.now(),
        t: options.startT,
        resolve,
      };
      // First frame now, so the overlay never shows a stale picture.
      this.draw(options.startT);
      this.frame = requestAnimationFrame(this.tick);
    });
  }

  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const active = this.active;
    this.active = null;
    active?.resolve("cancelled");
  }

  dispose() {
    this.cancel();
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleRestored,
    );
    if (!this.lost) this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private readonly tick = (now: number) => {
    const active = this.active;
    if (!active) return;
    const { startT, durationMs } = active.options;
    const t = Math.min(
      1,
      Math.max(startT, startT + (now - active.start) / durationMs),
    );
    active.t = t;
    this.draw(t);
    if (t >= 1) {
      this.active = null;
      this.frame = 0;
      active.resolve("done");
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly handleLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.cancel();
    this.events.onLost();
  };

  private readonly handleRestored = () => {
    try {
      this.setup();
    } catch {
      return; // Stay lost: the stage keeps its CSS fallback.
    }
    this.lost = false;
    this.events.onRestored();
  };

  private setup() {
    const { gl } = this;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
    this.program = program;
    this.uniforms = Object.fromEntries(
      ["uFrom", "uTo", "uT", "uDir", "uPeak", "uBlur", "uTexSize"].map(
        (name) => [name, gl.getUniformLocation(program, name)],
      ),
    );
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.textures = [gl.createTexture()!, gl.createTexture()!];
  }

  private upload(texture: WebGLTexture, bitmap: ImageBitmap) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private draw(t: number) {
    const { gl, uniforms: u } = this;
    const options = this.active?.options;
    if (!options || this.lost) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1]!);
    gl.uniform1i(u.uFrom!, 0);
    gl.uniform1i(u.uTo!, 1);
    gl.uniform1f(u.uT!, t);
    gl.uniform1f(u.uDir!, options.dir);
    gl.uniform1f(u.uPeak!, options.peak);
    gl.uniform1f(u.uBlur!, options.blur);
    gl.uniform1f(u.uTexSize!, COVER_TEXTURE_SIZE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
