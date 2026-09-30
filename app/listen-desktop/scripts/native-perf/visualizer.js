import { MusicVisualizer } from "@/components/player/visualizer/MusicVisualizer";

const REPORT_URL = "http://127.0.0.1:18766/report";
const canvas = document.querySelector("#visualizer");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const measurements = [];
const analyser = {
  fftSize: 2048,
  frequencyBinCount: 1024,
  sampleRate: 48000,
  phase: 0,
  getByteFrequencyData(values) {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = 70 + 45 * Math.sin(i * 0.027 + this.phase);
    }
    this.phase += 0.035;
  },
  getByteTimeDomainData(values) {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = 128 + 70 * Math.sin(i * 0.032 + this.phase);
    }
  },
};

let visualizer = null;
let activeMeasurement = null;
let runEnvironment = null;
let previousTick = MusicVisualizer.prototype.tick;
let stopRequested = false;
let visualizerTickCount = 0;

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? sorted.at(-1);
}

function summarize(values) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: percentile(values, 1),
  };
}

function rendererDetails() {
  const gl = canvas.getContext("webgl2");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    webglVersion: gl?.getParameter(gl.VERSION) ?? null,
    renderer: extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(gl.RENDERER) ?? null,
    vendor: extension
      ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
      : gl?.getParameter(gl.VENDOR) ?? null,
    contextAttributes: gl?.getContextAttributes() ?? null,
  };
}

function beginPhase(name) {
  activeMeasurement = {
    name,
    startedAt: new Date().toISOString(),
    frameIntervalsMs: [],
    tickDurationsMs: [],
    lastFrameAt: null,
    size: { width: canvas.width, height: canvas.height },
  };
  measurements.push(activeMeasurement);
  statusElement.textContent = `${name}: recording 30 seconds`;
}

MusicVisualizer.prototype.tick = function measuredTick(...args) {
  const startedAt = performance.now();
  visualizerTickCount += 1;
  if (activeMeasurement) {
    const now = startedAt;
    if (activeMeasurement.lastFrameAt !== null) {
      activeMeasurement.frameIntervalsMs.push(
        now - activeMeasurement.lastFrameAt,
      );
    }
    activeMeasurement.lastFrameAt = now;
    activeMeasurement.devicePixelRatio = window.devicePixelRatio;
  }
  try {
    return previousTick.apply(this, args);
  } finally {
    if (activeMeasurement) {
      activeMeasurement.tickDurationsMs.push(performance.now() - startedAt);
      activeMeasurement.size = { width: canvas.width, height: canvas.height };
    }
  }
};

function ensureVisualizer() {
  if (visualizer) return;
  visualizer = new MusicVisualizer(
    canvas,
    analyser,
    () => ({ volume: 0.5, isPlaying: true }),
    "spheres",
    "default",
  );
}

async function postReport(event) {
  try {
    const response = await fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error("Could not save visualizer measurements", error);
  }
}

async function runMeasurements() {
  stopRequested = false;
  startButton.disabled = true;
  ensureVisualizer();
  const environment = {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio,
    canvasCssSize: {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    },
    canvasRenderSize: { width: canvas.width, height: canvas.height },
    renderer: rendererDetails(),
    visibilityState: document.visibilityState,
    visibilityChanges: [],
    renderSizes: [
      {
        at: new Date().toISOString(),
        width: canvas.width,
        height: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
      },
    ],
  };
  runEnvironment = environment;

  for (let repetition = 1; repetition <= 3; repetition += 1) {
    visualizer.start();
    beginPhase(`visible-${repetition}`);
    await new Promise((resolve) => window.setTimeout(resolve, 30_000));
    if (stopRequested) break;
    const completed = activeMeasurement;
    activeMeasurement = null;
    completed.frameIntervals = summarize(completed.frameIntervalsMs);
    completed.tickDurations = summarize(completed.tickDurationsMs);
    delete completed.frameIntervalsMs;
    delete completed.tickDurationsMs;
    statusElement.textContent = `${completed.name} finished`;
    resultsElement.textContent = JSON.stringify(
      { environment, measurements },
      null,
      2,
    );
    await postReport({
      type: "visualizer-benchmark",
      environment,
      measurement: completed,
    });
    if (repetition < 3)
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }

  visualizer.stop();
  const ticksAtStop = visualizerTickCount;
  await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  const stopCheck = {
    observationMs: 2_000,
    ticksBefore: ticksAtStop,
    ticksAfter: visualizerTickCount,
    passed: visualizerTickCount === ticksAtStop,
  };
  await postReport({ type: "visualizer-stop-check", stopCheck });
  statusElement.textContent = `Measurements complete. RAF stop: ${
    stopCheck.passed ? "pass" : "fail"
  }. Close window to end probe.`;
  startButton.disabled = false;
}

startButton.addEventListener("click", () => {
  runMeasurements().catch((error) => {
    statusElement.textContent = `Failed: ${error}`;
    startButton.disabled = false;
  });
});

stopButton.addEventListener("click", () => {
  stopRequested = true;
  activeMeasurement = null;
  visualizer?.stop();
  startButton.disabled = false;
  statusElement.textContent = "Renderer stopped.";
});

new ResizeObserver(() => {
  if (!visualizer || !canvas.clientWidth || !canvas.clientHeight) return;
  const previousWidth = canvas.width;
  const previousHeight = canvas.height;
  visualizer.setSize(canvas.clientWidth, canvas.clientHeight);
  if (canvas.width !== previousWidth || canvas.height !== previousHeight) {
    runEnvironment?.renderSizes.push({
      at: new Date().toISOString(),
      width: canvas.width,
      height: canvas.height,
      devicePixelRatio: window.devicePixelRatio,
    });
  }
}).observe(canvas);

document.addEventListener("visibilitychange", () => {
  runEnvironment?.visibilityChanges.push({
    at: new Date().toISOString(),
    state: document.visibilityState,
  });
});

window.setTimeout(() => {
  window.focus();
  void postReport({
    type: "visualizer-probe-page-ready",
    url: location.href,
    visibilityState: document.visibilityState,
  });
  startButton.click();
}, 1_000);
