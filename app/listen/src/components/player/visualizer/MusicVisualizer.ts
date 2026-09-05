import { vec3, vec4 } from "gl-matrix";
import { type VisualizerMode } from "@/lib/player-visualizer-prefs";
import { setGL } from "./globals";
import Icosphere from "./geometry/Icosphere";
import Ring from "./geometry/Ring";
import Square from "./geometry/Square";
import OpenGLRenderer from "./rendering/OpenGLRenderer";
import Camera from "./Camera";
import ShaderProgram, { Shader } from "./rendering/ShaderProgram";
import {
  LINE_VERT,
  LINE_FRAG,
  BLUR_FRAG,
  BLEND_FRAG,
  QUAD_VERT,
} from "./shaders";
import {
  DEFAULT_VISUALIZER_COLORS,
  type VisualizerColorTriplet,
} from "./visualizer-colors";
import {
  type AudioMetrics,
  VisualizerAudioAnalyzer,
} from "./visualizer-audio-analyzer";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const mix = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * mix,
    a[1] + (b[1] - a[1]) * mix,
    a[2] + (b[2] - a[2]) * mix,
  ];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export class MusicVisualizer {
  private glCtx: WebGL2RenderingContext;
  private audioAnalyzer: VisualizerAudioAnalyzer;

  private renderer!: OpenGLRenderer;
  private camera!: Camera;
  private line!: ShaderProgram;
  private blur!: ShaderProgram;
  private quad!: ShaderProgram;

  private sphere1!: Icosphere;
  private sphere2!: Icosphere;
  private sphere3!: Icosphere;
  private ring!: Ring;
  private square!: Square;

  private fbo!: WebGLFramebuffer;
  private colorTex!: WebGLTexture;
  private brightTex!: WebGLTexture;
  private rboDepth!: WebGLRenderbuffer;
  private blurFBOs: WebGLFramebuffer[] = [];
  private blurTexs: WebGLTexture[] = [];

  private time = 0;
  private rafId = 0;
  private running = false;
  private canvas: HTMLCanvasElement;
  private width = 0;
  private height = 0;
  private renderedSeparation = 0.15;
  private renderedGlow = 6.0;
  private renderedScale = 1.4;
  private renderedPersistence = 0.8;
  private renderedOctaves = 2;
  private renderedOrbitSpeed = 1.0;
  private renderedCameraDrift = 1.0;
  private renderedCameraDepth = 0.0;
  private renderedPulseGain = 1.0;
  private renderedTurbulence = 1.0;
  private renderedOrbitPhase = 0.0;
  private renderedShellDensity = 1.0;
  private renderedBeatResponse = 1.0;
  private renderedBeatDecay = 0.88;
  private renderedSectionRate = 1.0;
  private renderedSectionDepth = 0.12;
  private renderedLowBandWeight = 1.0;
  private renderedMidBandWeight = 1.0;
  private renderedHighBandWeight = 1.0;
  private viewportScaleCompensation = 1.0;
  private renderedColor1: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[0],
  ];
  private renderedColor2: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[1],
  ];
  private renderedColor3: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[2],
  ];

  // Exposed controls
  separation = 0.15;
  glow = 6.0;
  scale = 1.4;
  persistence = 0.8;
  octaves = 2;
  mode: VisualizerMode;
  orbitSpeed = 1.0;
  cameraDrift = 1.0;
  cameraDepth = 0.0;
  pulseGain = 1.0;
  turbulence = 1.0;
  orbitPhase = 0.0;
  shellDensity = 1.0;
  beatResponse = 1.0;
  beatDecay = 0.88;
  sectionRate = 1.0;
  sectionDepth = 0.12;
  lowBandWeight = 1.0;
  midBandWeight = 1.0;
  highBandWeight = 1.0;
  analysisGainCompensation = 1.0;

  // Dynamic scene colors — [r, g, b] normalized 0-1
  color1: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[0]];
  color2: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[1]];
  color3: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[2]];

  constructor(
    canvas: HTMLCanvasElement,
    analyser: AnalyserNode,
    getPlaybackState: () => { volume: number; isPlaying: boolean },
    mode: VisualizerMode = "spheres",
  ) {
    const glCtx = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!glCtx) throw new Error("WebGL2 not supported");

    this.canvas = canvas;
    this.glCtx = glCtx;
    this.audioAnalyzer = new VisualizerAudioAnalyzer(
      analyser,
      getPlaybackState,
    );
    this.mode = mode;

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.min(Math.floor(canvas.clientWidth * dpr), MAX_DIM);
    this.height = Math.min(Math.floor(canvas.clientHeight * dpr), MAX_DIM);
    canvas.width = this.width;
    canvas.height = this.height;
    this.updateViewportScaleCompensation();

    setGL(glCtx);
    this.initScene();
  }

  private updateViewportScaleCompensation() {
    const rawReference = this.canvas.dataset.vizReferenceSize;
    const referenceSize = rawReference ? Number.parseFloat(rawReference) : NaN;
    const currentSize = Math.max(
      1,
      Math.min(this.canvas.clientWidth || 0, this.canvas.clientHeight || 0),
    );

    if (
      !Number.isFinite(referenceSize) ||
      referenceSize <= 0 ||
      currentSize <= 0
    ) {
      this.viewportScaleCompensation = 1.0;
      return;
    }

    this.viewportScaleCompensation = clamp(
      referenceSize / currentSize,
      0.7,
      1.0,
    );
  }

  setMode(mode: VisualizerMode) {
    this.mode = mode;
  }

  setAnalyser(analyser: AnalyserNode) {
    this.audioAnalyzer.setAnalyser(analyser);
  }

  accentTrackChange(strength = 1) {
    this.audioAnalyzer.accentTrackChange(strength);
  }

  private updateTrackMorph() {
    const ease = 0.085;
    const colorEase = 0.065;

    this.renderedSeparation = lerp(
      this.renderedSeparation,
      this.separation,
      ease,
    );
    this.renderedGlow = lerp(this.renderedGlow, this.glow, ease);
    this.renderedScale = lerp(this.renderedScale, this.scale, ease);
    this.renderedPersistence = lerp(
      this.renderedPersistence,
      this.persistence,
      ease,
    );
    this.renderedOctaves = lerp(this.renderedOctaves, this.octaves, ease);
    this.renderedOrbitSpeed = lerp(
      this.renderedOrbitSpeed,
      this.orbitSpeed,
      ease,
    );
    this.renderedCameraDrift = lerp(
      this.renderedCameraDrift,
      this.cameraDrift,
      ease,
    );
    this.renderedCameraDepth = lerp(
      this.renderedCameraDepth,
      this.cameraDepth,
      ease,
    );
    this.renderedPulseGain = lerp(this.renderedPulseGain, this.pulseGain, ease);
    this.renderedTurbulence = lerp(
      this.renderedTurbulence,
      this.turbulence,
      ease,
    );
    this.renderedOrbitPhase = lerp(
      this.renderedOrbitPhase,
      this.orbitPhase,
      ease,
    );
    this.renderedShellDensity = lerp(
      this.renderedShellDensity,
      this.shellDensity,
      ease,
    );
    this.renderedBeatResponse = lerp(
      this.renderedBeatResponse,
      this.beatResponse,
      ease,
    );
    this.renderedBeatDecay = lerp(this.renderedBeatDecay, this.beatDecay, ease);
    this.renderedSectionRate = lerp(
      this.renderedSectionRate,
      this.sectionRate,
      ease,
    );
    this.renderedSectionDepth = lerp(
      this.renderedSectionDepth,
      this.sectionDepth,
      ease,
    );
    this.renderedLowBandWeight = lerp(
      this.renderedLowBandWeight,
      this.lowBandWeight,
      ease,
    );
    this.renderedMidBandWeight = lerp(
      this.renderedMidBandWeight,
      this.midBandWeight,
      ease,
    );
    this.renderedHighBandWeight = lerp(
      this.renderedHighBandWeight,
      this.highBandWeight,
      ease,
    );

    this.renderedColor1 = [
      lerp(this.renderedColor1[0], this.color1[0], colorEase),
      lerp(this.renderedColor1[1], this.color1[1], colorEase),
      lerp(this.renderedColor1[2], this.color1[2], colorEase),
    ];
    this.renderedColor2 = [
      lerp(this.renderedColor2[0], this.color2[0], colorEase),
      lerp(this.renderedColor2[1], this.color2[1], colorEase),
      lerp(this.renderedColor2[2], this.color2[2], colorEase),
    ];
    this.renderedColor3 = [
      lerp(this.renderedColor3[0], this.color3[0], colorEase),
      lerp(this.renderedColor3[1], this.color3[1], colorEase),
      lerp(this.renderedColor3[2], this.color3[2], colorEase),
    ];
  }

  private initScene() {
    const g = this.glCtx;

    this.sphere3 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 5, g.LINES);
    this.sphere3.create();
    this.sphere2 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 4, g.LINES);
    this.sphere2.create();
    this.sphere1 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 3, g.LINES);
    this.sphere1.create();
    this.ring = new Ring(1, 256, g.LINES);
    this.ring.create();
    this.square = new Square(vec3.fromValues(0, 0, 0));
    this.square.create();

    this.camera = new Camera(
      vec3.fromValues(0, 0, 5),
      vec3.fromValues(0, 0, 0),
    );
    this.camera.setAspectRatio(this.width / Math.max(this.height, 1));
    this.camera.updateProjectionMatrix();

    this.renderer = new OpenGLRenderer(this.canvas);
    this.renderer.setClearColor(0.0, 0.0, 0.0, 0.0);
    this.renderer.setSize(this.width, this.height);
    g.enable(g.DEPTH_TEST);

    this.line = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, LINE_VERT),
      new Shader(g.FRAGMENT_SHADER, LINE_FRAG),
    ]);
    this.blur = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, QUAD_VERT),
      new Shader(g.FRAGMENT_SHADER, BLUR_FRAG),
    ]);
    this.quad = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, QUAD_VERT),
      new Shader(g.FRAGMENT_SHADER, BLEND_FRAG),
    ]);

    this.setupFBOs();

    this.blur.use();
    g.uniform1i(g.getUniformLocation(this.blur.prog, "scene"), 0);
    this.quad.use();
    g.uniform1i(g.getUniformLocation(this.quad.prog, "scene"), 0);
    g.uniform1i(g.getUniformLocation(this.quad.prog, "blurred"), 1);
  }

  private setupFBOs() {
    const g = this.glCtx;
    const w = this.width || this.canvas.width || 440;
    const h = this.height || this.canvas.height || 250;

    this.fbo = g.createFramebuffer()!;

    this.colorTex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      w,
      h,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );

    this.brightTex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.brightTex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      w,
      h,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );

    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(
      g.DRAW_FRAMEBUFFER,
      g.COLOR_ATTACHMENT0,
      g.TEXTURE_2D,
      this.colorTex,
      0,
    );
    g.framebufferTexture2D(
      g.DRAW_FRAMEBUFFER,
      g.COLOR_ATTACHMENT1,
      g.TEXTURE_2D,
      this.brightTex,
      0,
    );

    this.rboDepth = g.createRenderbuffer()!;
    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, w, h);
    g.framebufferRenderbuffer(
      g.FRAMEBUFFER,
      g.DEPTH_ATTACHMENT,
      g.RENDERBUFFER,
      this.rboDepth,
    );
    g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    this.blurFBOs = [g.createFramebuffer()!, g.createFramebuffer()!];
    this.blurTexs = [g.createTexture()!, g.createTexture()!];

    for (let i = 0; i < 2; i++) {
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[i]!);
      g.bindTexture(g.TEXTURE_2D, this.blurTexs[i]!);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        w,
        h,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        null,
      );
      g.framebufferTexture2D(
        g.DRAW_FRAMEBUFFER,
        g.COLOR_ATTACHMENT0,
        g.TEXTURE_2D,
        this.blurTexs[i]!,
        0,
      );
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  private readAudioMetrics(): AudioMetrics {
    return this.audioAnalyzer.read({
      time: this.time,
      beatResponse: this.renderedBeatResponse,
      beatDecay: this.renderedBeatDecay,
    });
  }

  private updateCamera(metrics: AudioMetrics) {
    this.camera.position = vec3.fromValues(
      Math.sin(
        this.time * 0.0025 * this.renderedOrbitSpeed + this.renderedOrbitPhase,
      ) *
        0.08 *
        this.renderedCameraDrift,
      Math.cos(
        this.time * 0.002 * this.renderedOrbitSpeed +
          this.renderedOrbitPhase * 0.6,
      ) *
        0.06 *
        this.renderedCameraDrift,
      5 +
        this.renderedCameraDepth -
        metrics.pulse * 0.08 * this.renderedPulseGain -
        this.audioAnalyzer.arrivalAccentPulse * 0.12,
    );
    this.camera.update();
  }

  private renderSpheresScene(metrics: AudioMetrics) {
    this.line.setTime(this.time);
    this.line.setAudio(metrics.freqAvg, metrics.timeAvg);

    const beat = metrics.beat * this.renderedBeatResponse;
    const sectionWave =
      0.5 +
      0.5 *
        Math.sin(
          this.time * 0.0014 * this.renderedSectionRate +
            this.renderedOrbitPhase * 0.35,
        );
    const sectionLift = (sectionWave - 0.5) * 2 * this.renderedSectionDepth;
    const arrival = this.audioAnalyzer.arrivalAccentPulse;
    const pulseLow =
      (metrics.low * this.renderedLowBandWeight + beat * 0.5) *
      this.renderedPulseGain;
    const pulseMid =
      (metrics.mid * this.renderedMidBandWeight +
        beat * 0.22 +
        metrics.transient * 0.35) *
      this.renderedPulseGain;
    const pulseHigh =
      (metrics.high * this.renderedHighBandWeight + metrics.transient * 0.28) *
      this.renderedPulseGain;
    const turbulence =
      this.renderedTurbulence + sectionLift * 0.18 + arrival * 0.16;
    const shellGap =
      this.renderedSeparation *
      clamp(
        1.22 -
          (this.renderedShellDensity - 1) * 0.7 +
          sectionLift * 0.18 +
          arrival * 0.12,
        0.7,
        1.4,
      );
    const coreDetail =
      3 +
      this.renderedOctaves +
      beat * 0.3 +
      this.renderedShellDensity * 0.2 +
      sectionLift * 0.2 +
      arrival * 0.35;
    const midDetail =
      1 +
      this.renderedOctaves +
      this.renderedShellDensity * 0.15 +
      sectionLift * 0.15 +
      arrival * 0.18;
    const outerDetail =
      2 +
      this.renderedOctaves +
      metrics.transient * 0.4 +
      this.renderedShellDensity * 0.1 +
      sectionLift * 0.1 +
      arrival * 0.22;
    const colorLift = clamp(arrival * 0.18 + beat * 0.05, 0, 0.24);
    const color1 = mixColor(this.renderedColor1, [1, 1, 1], colorLift);
    const color2 = mixColor(this.renderedColor2, [1, 1, 1], colorLift * 0.85);
    const color3 = mixColor(this.renderedColor3, [1, 1, 1], colorLift * 0.72);

    let scaleVal =
      (1.16 +
        pulseLow * 0.3 +
        beat * 0.11 +
        this.renderedCameraDepth * 0.08 +
        sectionLift * 0.08 +
        arrival * 0.1) *
      this.viewportScaleCompensation;
    this.line.setNoise(
      this.renderedScale *
        2.0 *
        turbulence *
        (0.92 + this.renderedShellDensity * 0.08),
      this.renderedPersistence * (0.48 + sectionWave * 0.04),
      coreDetail,
      0.005 * turbulence + this.renderedOrbitPhase * 0.001,
    );
    this.line.setGeometryColor(
      vec4.fromValues(color1[0], color1[1], color1[2], 1.0),
    );
    this.renderer.render(this.camera, this.line, [this.sphere3], scaleVal);

    scaleVal += shellGap + pulseMid * 0.1;
    this.line.setNoise(
      this.renderedScale * turbulence,
      this.renderedPersistence * (0.18 + beat * 0.06 + sectionWave * 0.02),
      midDetail,
      -0.01 * turbulence + this.renderedOrbitPhase * 0.0006,
    );
    this.line.setGeometryColor(
      vec4.fromValues(color2[0], color2[1], color2[2], 1.0),
    );
    this.renderer.render(this.camera, this.line, [this.sphere2], scaleVal);

    scaleVal += shellGap + pulseHigh * 0.08;
    this.line.setNoise(
      this.renderedScale * (0.92 + turbulence * 0.08 + beat * 0.04),
      this.renderedPersistence *
        (0.94 + metrics.transient * 0.12 + sectionLift * 0.05),
      outerDetail,
      0.01 * turbulence - this.renderedOrbitPhase * 0.0008,
    );
    this.line.setGeometryColor(
      vec4.fromValues(color3[0], color3[1], color3[2], 1.0),
    );
    this.renderer.render(this.camera, this.line, [this.sphere1], scaleVal);
  }

  private renderScene(metrics: AudioMetrics) {
    this.renderSpheresScene(metrics);
  }

  setSize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.updateViewportScaleCompensation();

    const g = this.glCtx;

    this.renderer.setSize(w, h);
    this.camera.setAspectRatio(w / h);
    this.camera.updateProjectionMatrix();

    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      w,
      h,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindTexture(g.TEXTURE_2D, this.brightTex);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      w,
      h,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, w, h);
    g.bindRenderbuffer(g.RENDERBUFFER, null);

    for (let i = 0; i < 2; i++) {
      g.bindTexture(g.TEXTURE_2D, this.blurTexs[i]!);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        w,
        h,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        null,
      );
      g.bindTexture(g.TEXTURE_2D, null);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  tick() {
    if (!this.running) return;

    const g = this.glCtx;
    this.time++;

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(Math.floor(this.canvas.clientWidth * dpr), MAX_DIM);
    const h = Math.min(Math.floor(this.canvas.clientHeight * dpr), MAX_DIM);
    this.updateViewportScaleCompensation();
    if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) {
      this.setSize(w, h);
    }

    this.updateTrackMorph();
    const metrics = this.readAudioMetrics();
    this.updateCamera(metrics);

    g.viewport(0, 0, this.width, this.height);
    this.renderer.clear();

    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    this.renderer.clear();
    this.renderScene(metrics);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    let horizontal = true;
    let firstIteration = true;
    this.blur.use();
    this.renderer.clear();

    const horizontalLoc = g.getUniformLocation(this.blur.prog, "u_Horizontal");
    for (let i = 0; i < 10; i++) {
      const idx = Number(horizontal);
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[idx]!);
      g.uniform1i(horizontalLoc, idx);
      g.bindTexture(
        g.TEXTURE_2D,
        firstIteration ? this.brightTex : this.blurTexs[Number(!horizontal)]!,
      );
      this.renderer.render(this.camera, this.blur, [this.square]);
      horizontal = !horizontal;
      firstIteration = false;
    }

    g.bindFramebuffer(g.FRAMEBUFFER, null);
    this.renderer.clear();
    this.quad.use();
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.blurTexs[Number(!horizontal)]!);
    this.quad.setBloom(
      this.renderedGlow + this.audioAnalyzer.arrivalAccentPulse * 1.8,
    );
    this.renderer.render(this.camera, this.quad, [this.square]);

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  destroy() {
    this.stop();
    const g = this.glCtx;

    this.sphere1?.destroy();
    this.sphere2?.destroy();
    this.sphere3?.destroy();
    this.ring?.destroy();
    this.square?.destroy();

    if (this.colorTex) g.deleteTexture(this.colorTex);
    if (this.brightTex) g.deleteTexture(this.brightTex);
    if (this.rboDepth) g.deleteRenderbuffer(this.rboDepth);
    if (this.fbo) g.deleteFramebuffer(this.fbo);
    for (const fbo of this.blurFBOs) g.deleteFramebuffer(fbo);
    for (const tex of this.blurTexs) g.deleteTexture(tex);

    const ext = g.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }
}
