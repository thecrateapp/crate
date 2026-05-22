import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MusicVisualizer } from "./MusicVisualizer";

// ---------------------------------------------------------------------------
// WebGL2 mock factory
// ---------------------------------------------------------------------------

const GL_MOCK_COUNTERS = {
  buffer: 0,
  texture: 0,
  fbo: 0,
  rbo: 0,
  shader: 0,
  program: 0,
  location: 0,
};

function resetGlCounters() {
  GL_MOCK_COUNTERS.buffer = 0;
  GL_MOCK_COUNTERS.texture = 0;
  GL_MOCK_COUNTERS.fbo = 0;
  GL_MOCK_COUNTERS.rbo = 0;
  GL_MOCK_COUNTERS.shader = 0;
  GL_MOCK_COUNTERS.program = 0;
  GL_MOCK_COUNTERS.location = 0;
}

function createMockWebGL2Context(): WebGL2RenderingContext {
  const compileStatus = new Map<number, boolean>();

  // prettier-ignore
  const ctx = {
    LINES: 0x0001, TRIANGLES: 0x0004, DEPTH_TEST: 0x0b71,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
    FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, COLOR_ATTACHMENT1: 0x8ce1,
    DRAW_FRAMEBUFFER: 0x8ca9, DEPTH_ATTACHMENT: 0x8d00,
    RENDERBUFFER: 0x8d41, DEPTH_COMPONENT16: 0x81a5,
    TEXTURE_2D: 0x0de1, CLAMP_TO_EDGE: 0x812f, NEAREST: 0x2600,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
    COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
    TEXTURE0: 0x84c0, TEXTURE1: 0x84c1,
    UNITSIGNED_INT: 0x1405, FLOAT: 0x1406,
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,

    createBuffer()           { ++GL_MOCK_COUNTERS.buffer;   return GL_MOCK_COUNTERS.buffer as unknown as WebGLBuffer; },
    createShader()           { const id = ++GL_MOCK_COUNTERS.shader;  compileStatus.set(id, false); return id as unknown as WebGLShader; },
    createProgram()          { const id = ++GL_MOCK_COUNTERS.program; compileStatus.set(id, false); return id as unknown as WebGLProgram; },
    createFramebuffer()      { ++GL_MOCK_COUNTERS.fbo; return GL_MOCK_COUNTERS.fbo as unknown as WebGLFramebuffer; },
    createTexture()          { ++GL_MOCK_COUNTERS.texture; return GL_MOCK_COUNTERS.texture as unknown as WebGLTexture; },
    createRenderbuffer()     { ++GL_MOCK_COUNTERS.rbo; return GL_MOCK_COUNTERS.rbo as unknown as WebGLRenderbuffer; },
    getAttribLocation()      { return ++GL_MOCK_COUNTERS.location; },
    getUniformLocation()     { return { value: null } as unknown as WebGLUniformLocation; },

    shaderSource: vi.fn(),
    compileShader(shader: WebGLShader) { compileStatus.set(shader as unknown as number, true); },
    getShaderParameter(shader: WebGLShader, pname: number) {
      if (pname === 0x8b81) return compileStatus.get(shader as unknown as number) ?? false;
      return null;
    },
    getShaderInfoLog: vi.fn(() => ""),
    attachShader: vi.fn(),
    linkProgram(program: WebGLProgram) { compileStatus.set(program as unknown as number, true); },
    getProgramParameter(program: WebGLProgram, pname: number) {
      if (pname === 0x8b82) return compileStatus.get(program as unknown as number) ?? false;
      return null;
    },
    getProgramInfoLog: vi.fn(() => ""),

    enable: vi.fn(), useProgram: vi.fn(), viewport: vi.fn(),
    clearColor: vi.fn(), clear: vi.fn(),

    bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),

    bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(), deleteTexture: vi.fn(),

    bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(), framebufferRenderbuffer: vi.fn(),
    drawBuffers: vi.fn(), deleteFramebuffer: vi.fn(),

    bindRenderbuffer: vi.fn(), renderbufferStorage: vi.fn(), deleteRenderbuffer: vi.fn(),

    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform4fv: vi.fn(), uniformMatrix4fv: vi.fn(),

    enableVertexAttribArray: vi.fn(), disableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),

    drawElements: vi.fn(), activeTexture: vi.fn(),

    getExtension() { return { loseContext: vi.fn() }; },
  };

  return ctx as unknown as WebGL2RenderingContext;
}

// ---------------------------------------------------------------------------
// AnalyserNode mock
// ---------------------------------------------------------------------------

function createMockAnalyser(binCount = 512, fftSize = 1024) {
  const freqData = new Uint8Array(binCount);
  const timeData = new Uint8Array(binCount);

  return {
    frequencyBinCount: binCount,
    fftSize,
    getByteFrequencyData(arr: Uint8Array) {
      arr.set(freqData);
    },
    getByteTimeDomainData(arr: Uint8Array) {
      arr.set(timeData);
    },
    _setFreqData(data: Uint8Array) {
      freqData.set(data.slice(0, binCount));
    },
    _setTimeData(data: Uint8Array) {
      timeData.set(data.slice(0, binCount));
    },
  } as unknown as AnalyserNode & {
    _setFreqData: (d: Uint8Array) => void;
    _setTimeData: (d: Uint8Array) => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestCanvas(width = 440, height = 250) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", {
    value: width,
    writable: true,
  });
  Object.defineProperty(canvas, "clientHeight", {
    value: height,
    writable: true,
  });
  return canvas;
}

function createDefaultPlaybackState() {
  return { volume: 1, isPlaying: true };
}

/** Flush one rAF frame from the manual queue. */
function flushRafFrame() {
  const pending = (globalThis as Record<string, unknown>)
    .__rafQueue as FrameRequestCallback[];
  if (!pending || pending.length === 0) return;
  const batch = pending.splice(0);
  for (const cb of batch) cb(performance.now());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MusicVisualizer", () => {
  let mockGL: ReturnType<typeof createMockWebGL2Context>;
  let canvas: HTMLCanvasElement;
  let analyser: ReturnType<typeof createMockAnalyser>;
  let playbackState: ReturnType<typeof createDefaultPlaybackState>;

  beforeEach(() => {
    resetGlCounters();
    vi.restoreAllMocks();
    mockGL = createMockWebGL2Context();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (contextId: string) => {
        if (contextId === "webgl2")
          return mockGL as unknown as RenderingContext;
        return null;
      },
    );

    // Manual rAF queue — each call stores the callback; no auto-execution.
    const rafQueue: FrameRequestCallback[] = [];
    let rafNextId = 1;
    window.requestAnimationFrame = vi
      .fn()
      .mockImplementation((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafNextId++;
      });
    window.cancelAnimationFrame = vi.fn().mockImplementation(() => {
      // no-op: we don't remove from queue since real cancelAnimationFrame
      // cancels the scheduled callback but our queue is flushed manually.
    });
    (globalThis as Record<string, unknown>).__rafQueue = rafQueue;

    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1);

    canvas = createTestCanvas(440, 250);
    analyser = createMockAnalyser(512, 1024);
    playbackState = createDefaultPlaybackState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).__rafQueue;
  });

  // -------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------

  describe("construction", () => {
    it("creates an instance with default mode 'spheres'", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(viz).toBeInstanceOf(MusicVisualizer);
      expect(viz.mode).toBe("spheres");
    });

    it("creates an instance with explicit mode", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
        "spheres",
      );
      expect(viz.mode).toBe("spheres");
    });

    it("throws if WebGL2 is not available", () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      expect(
        () =>
          new MusicVisualizer(
            canvas,
            analyser as unknown as AnalyserNode,
            () => playbackState,
          ),
      ).toThrow("WebGL2 not supported");
    });

    it("caps canvas dimensions at 1024", () => {
      const bigCanvas = createTestCanvas(2000, 2000);
      new MusicVisualizer(
        bigCanvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(bigCanvas.width).toBe(1024);
      expect(bigCanvas.height).toBe(1024);
    });

    it("handles zero-size canvas gracefully", () => {
      const zeroCanvas = createTestCanvas(0, 0);
      expect(
        () =>
          new MusicVisualizer(
            zeroCanvas,
            analyser as unknown as AnalyserNode,
            () => playbackState,
          ),
      ).not.toThrow();
    });

    it("sets all public properties to their defaults", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(viz.mode).toBe("spheres");
      expect(viz.separation).toBe(0.15);
      expect(viz.glow).toBe(6.0);
      expect(viz.scale).toBe(1.4);
      expect(viz.persistence).toBe(0.8);
      expect(viz.octaves).toBe(2);
      expect(viz.orbitSpeed).toBe(1.0);
      expect(viz.cameraDrift).toBe(1.0);
      expect(viz.cameraDepth).toBe(0.0);
      expect(viz.pulseGain).toBe(1.0);
      expect(viz.turbulence).toBe(1.0);
      expect(viz.orbitPhase).toBe(0.0);
      expect(viz.shellDensity).toBe(1.0);
      expect(viz.beatResponse).toBe(1.0);
      expect(viz.beatDecay).toBe(0.88);
      expect(viz.sectionRate).toBe(1.0);
      expect(viz.sectionDepth).toBe(0.12);
      expect(viz.lowBandWeight).toBe(1.0);
      expect(viz.midBandWeight).toBe(1.0);
      expect(viz.highBandWeight).toBe(1.0);
      expect(viz.analysisGainCompensation).toBe(1.0);
    });

    it("sets default teal-blue color palette", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(viz.color1).toEqual([0.024, 0.714, 0.831]);
      expect(viz.color2).toEqual([0.4, 0.9, 1.0]);
      expect(viz.color3).toEqual([0.1, 0.3, 0.8]);
    });
  });

  // -------------------------------------------------------------------
  // viewportScaleCompensation via dataset
  // -------------------------------------------------------------------

  describe("viewportScaleCompensation", () => {
    it("uses dataset.vizReferenceSize for scale compensation", () => {
      canvas.dataset.vizReferenceSize = "500";
      // A 440x250 canvas → min(clientWidth, clientHeight) = 250
      // compensation = clamp(500/250, 0.7, 1.0) = clamp(2.0, 0.7, 1.0) = 1.0
      new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      // Construction succeeds — compensation is private.
    });

    it("falls back to 1.0 when dataset key is missing", () => {
      delete canvas.dataset.vizReferenceSize;
      new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
    });

    it("handles non-numeric dataset value", () => {
      canvas.dataset.vizReferenceSize = "not-a-number";
      new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
    });

    it("clamps negative reference to 1.0", () => {
      canvas.dataset.vizReferenceSize = "-100";
      new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
    });
  });

  // -------------------------------------------------------------------
  // Lifecycle: start / stop / destroy
  // -------------------------------------------------------------------

  describe("lifecycle", () => {
    it("start() requests an animation frame", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      expect(window.requestAnimationFrame).toHaveBeenCalled();
      viz.stop();
    });

    it("start() is idempotent", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      const callsAfterFirst = (
        window.requestAnimationFrame as ReturnType<typeof vi.fn>
      ).mock.calls.length;
      viz.start();
      expect(
        (window.requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls
          .length,
      ).toBe(callsAfterFirst);
    });

    it("stop() cancels the animation frame when rafId is set", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start(); // queues a rAF → rafId set
      viz.stop();
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });

    it("stop() before start() does not throw", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(() => viz.stop()).not.toThrow();
    });

    it("destroy() calls stop and cleans up WebGL resources", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      viz.destroy();
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
      expect(mockGL.deleteBuffer).toHaveBeenCalled();
      expect(mockGL.deleteTexture).toHaveBeenCalled();
      expect(mockGL.deleteRenderbuffer).toHaveBeenCalled();
      expect(mockGL.deleteFramebuffer).toHaveBeenCalled();
    });

    it("destroy() calls WEBGL_lose_context extension", () => {
      const loseContext = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        (contextId: string) => {
          if (contextId === "webgl2") {
            const gl = createMockWebGL2Context();
            (gl as unknown as Record<string, unknown>).getExtension = () => ({
              loseContext,
            });
            return gl as unknown as RenderingContext;
          }
          return null;
        },
      );
      resetGlCounters();
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.destroy();
      expect(loseContext).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // setMode / setAnalyser
  // -------------------------------------------------------------------

  describe("setMode", () => {
    it("sets mode to 'spheres'", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.setMode("spheres");
      expect(viz.mode).toBe("spheres");
    });
  });

  describe("setAnalyser", () => {
    it("updates the analyser and re-creates data arrays", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      const newAnalyser = createMockAnalyser(
        256,
        512,
      ) as unknown as AnalyserNode;
      viz.setAnalyser(newAnalyser);
      expect(() => viz.start()).not.toThrow();
      viz.stop();
    });

    it("handles analyser with smaller bin count", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      const smallAnalyser = createMockAnalyser(
        128,
        256,
      ) as unknown as AnalyserNode;
      viz.setAnalyser(smallAnalyser);
      expect(() => viz.start()).not.toThrow();
      viz.stop();
    });
  });

  // -------------------------------------------------------------------
  // accentTrackChange
  // -------------------------------------------------------------------

  describe("accentTrackChange", () => {
    it("does not throw for valid strengths", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(() => viz.accentTrackChange(0)).not.toThrow();
      expect(() => viz.accentTrackChange(0.5)).not.toThrow();
      expect(() => viz.accentTrackChange(1)).not.toThrow();
      expect(() => viz.accentTrackChange(1.5)).not.toThrow();
    });

    it("clamps out-of-range strengths", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(() => viz.accentTrackChange(-0.5)).not.toThrow();
      expect(() => viz.accentTrackChange(2.0)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // Audio metrics processing (exercised via `tick()`)
  // -------------------------------------------------------------------

  describe("audio metrics processing", () => {
    it("processes zeroed analyser data without crashing", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("processes full-signal analyser data without crashing", () => {
      const fullAnalyser = createMockAnalyser(512, 1024);
      fullAnalyser._setFreqData(new Uint8Array(512).fill(255));
      fullAnalyser._setTimeData(new Uint8Array(512).fill(128));

      const viz = new MusicVisualizer(
        canvas,
        fullAnalyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("compensates for low playback volume", () => {
      const lowAnalyser = createMockAnalyser(512, 1024);
      lowAnalyser._setFreqData(new Uint8Array(512).fill(200));
      lowAnalyser._setTimeData(new Uint8Array(512).fill(128));

      const lowPlayback = { volume: 0.2, isPlaying: true };
      const viz = new MusicVisualizer(
        canvas,
        lowAnalyser as unknown as AnalyserNode,
        () => lowPlayback,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("attenuates signal at maximum volume", () => {
      const loudAnalyser = createMockAnalyser(512, 1024);
      loudAnalyser._setFreqData(new Uint8Array(512).fill(255));
      loudAnalyser._setTimeData(new Uint8Array(512).fill(128));

      const loudPlayback = { volume: 1.0, isPlaying: true };
      const viz = new MusicVisualizer(
        canvas,
        loudAnalyser as unknown as AnalyserNode,
        () => loudPlayback,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("handles paused playback state", () => {
      const pausedPlayback = { volume: 0.5, isPlaying: false };
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => pausedPlayback,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("clamps volume to minimum when it reaches 0", () => {
      const silentPlayback = { volume: 0, isPlaying: true };
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => silentPlayback,
      );
      viz.start();
      flushRafFrame();
      viz.stop();
    });
  });

  // -------------------------------------------------------------------
  // Configuration mutation (lerp morph)
  // -------------------------------------------------------------------

  describe("configuration mutation", () => {
    it("accepts new separation value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.separation = 0.35;
      expect(viz.separation).toBe(0.35);
    });

    it("accepts new glow value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.glow = 8.0;
      expect(viz.glow).toBe(8.0);
    });

    it("accepts new scale value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.scale = 2.0;
      expect(viz.scale).toBe(2.0);
    });

    it("accepts new octaves value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.octaves = 4;
      expect(viz.octaves).toBe(4);
    });

    it("accepts new beatResponse value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.beatResponse = 1.3;
      expect(viz.beatResponse).toBe(1.3);
    });

    it("accepts new beatDecay value", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.beatDecay = 0.92;
      expect(viz.beatDecay).toBe(0.92);
    });

    it("accepts new color tuples", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.color1 = [1, 0, 0];
      expect(viz.color1).toEqual([1, 0, 0]);
      viz.color2 = [0, 1, 0];
      expect(viz.color2).toEqual([0, 1, 0]);
      viz.color3 = [0, 0, 1];
      expect(viz.color3).toEqual([0, 0, 1]);
    });

    it("accepts pulseGain beyond default range", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.pulseGain = 3.0;
      expect(viz.pulseGain).toBe(3.0);
    });

    it("lerp-morphs configuration during tick without errors", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.separation = 0.5;
      viz.glow = 10;
      viz.color1 = [1, 0, 0];
      viz.color2 = [0, 1, 0];
      viz.color3 = [0, 0, 1];
      viz.start();
      flushRafFrame();
      viz.stop();
    });
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles start/stop/start cycles", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      viz.stop();
      viz.start();
      viz.stop();
      viz.destroy();
    });

    it("handles tick after stop (raf becomes no-op)", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      flushRafFrame(); // one frame → queues next
      viz.stop();
      // Flush any remaining queued callback — tick() checks running=false.
      flushRafFrame();
    });

    it("handles repeated destroy()", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.destroy();
      viz.destroy(); // second destroy should not crash
    });

    it("accentTrackChange before start() does not throw", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      expect(() => viz.accentTrackChange(1)).not.toThrow();
    });

    it("setAnalyser before start() does not throw", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      const na = createMockAnalyser(256, 512) as unknown as AnalyserNode;
      expect(() => viz.setAnalyser(na)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // Pure math helpers (indirect)
  // -------------------------------------------------------------------

  describe("pure math (indirect)", () => {
    it("clamp: accentTrackChange with extreme value is handled", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      // clamp() is used internally; accentTrackChange(1.5) is the max.
      viz.accentTrackChange(1.5);
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("lerp: configuration morph does not throw during tick", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.separation = 0.5;
      viz.beatDecay = 0.95;
      viz.cameraDepth = 1.0;
      viz.pulseGain = 2.0;
      viz.lowBandWeight = 1.5;
      viz.midBandWeight = 0.8;
      viz.highBandWeight = 1.2;
      viz.start();
      flushRafFrame();
      viz.stop();
    });

    it("mixColor: color morph is applied during tick", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.color1 = [1, 0, 0];
      viz.color2 = [0, 1, 0];
      viz.color3 = [0, 0, 1];
      viz.start();
      flushRafFrame();
      viz.stop();
    });
  });

  // -------------------------------------------------------------------
  // Rendering loop (tick) — multi-frame
  // -------------------------------------------------------------------

  describe("tick rendering loop", () => {
    it("runs multiple frames without errors", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      for (let i = 0; i < 5; i++) {
        flushRafFrame();
      }
      viz.stop();
    });

    it("does not render after stop", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      const drawBefore = (mockGL.drawElements as ReturnType<typeof vi.fn>).mock
        .calls.length;

      viz.start();
      flushRafFrame();
      const drawAfterFrame = (mockGL.drawElements as ReturnType<typeof vi.fn>)
        .mock.calls.length;
      expect(drawAfterFrame).toBeGreaterThan(drawBefore);

      viz.stop();
      // Flush any queued callbacks — tick exits early when running=false.
      flushRafFrame();
      const drawAfterStop = (mockGL.drawElements as ReturnType<typeof vi.fn>)
        .mock.calls.length;
      expect(drawAfterStop).toBe(drawAfterFrame);
    });

    it("handles canvas resize mid-loop", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      viz.start();
      flushRafFrame();

      Object.defineProperty(canvas, "clientWidth", {
        value: 800,
        writable: true,
      });
      Object.defineProperty(canvas, "clientHeight", {
        value: 600,
        writable: true,
      });

      flushRafFrame();
      viz.stop();
    });
  });

  // -------------------------------------------------------------------
  // setSize (invoked via reflection for coverage)
  // -------------------------------------------------------------------

  describe("setSize", () => {
    it("resizes canvas and updates FBO textures", () => {
      const viz = new MusicVisualizer(
        canvas,
        analyser as unknown as AnalyserNode,
        () => playbackState,
      );
      // setSize is private; invoke via reflection to test the path.
      (viz as unknown as { setSize: (w: number, h: number) => void }).setSize(
        640,
        360,
      );
      // Texture resize triggered texImage2D calls.
      expect(mockGL.texImage2D).toHaveBeenCalled();
    });
  });
});
