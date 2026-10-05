const resultElement = document.querySelector("#results");
const releaseButton = document.querySelector("#release");
const audioContext = new AudioContext();
const decodedBuffers = [];
const query = new URLSearchParams(location.search);
const trackNames = query.get("tracks")?.split(",") ?? ["track20", "track16"];
const releaseAfterMs = Number(query.get("releaseAfterMs") ?? 90_000);
const endpoint = `http://127.0.0.1:${query.get("port") ?? "18765"}`;
let released = false;

async function report(event, data = {}) {
  const row = { time: new Date().toISOString(), event, ...data };
  resultElement.textContent += `\n${JSON.stringify(row)}`;
  document.title = `Tauri audio probe: ${event}`;
  try {
    await fetch(`${endpoint}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
  } catch {
    resultElement.textContent +=
      "\nCould not write event to the fixture server.";
  }
}

async function releaseBuffers(reason) {
  if (released) return;
  released = true;
  const releasedCount = decodedBuffers.length;
  decodedBuffers.length = 0;
  await audioContext.close();
  releaseButton.disabled = true;
  await report("released", { reason, releasedCount });
}

async function decodeTrack(name) {
  await report("fetch-start", { name });
  const response = await fetch(`${endpoint}/track/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const encoded = await response.arrayBuffer();
  await report("fetch-done", { name, encodedBytes: encoded.byteLength });

  const buffer = await audioContext.decodeAudioData(encoded);
  decodedBuffers.push(buffer);
  await report("decode-done", {
    name,
    durationSeconds: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    pcmBytes:
      buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
    retainedPcmBytes: decodedBuffers.reduce(
      (total, item) =>
        total +
        item.length * item.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
      0,
    ),
  });
}

async function run() {
  resultElement.textContent = "";
  await report("audio-context", { sampleRate: audioContext.sampleRate });
  for (const name of trackNames) await decodeTrack(name);
  releaseButton.disabled = false;
  await report("ready", { buffers: decodedBuffers.length });
  window.setTimeout(() => void releaseBuffers("timer"), releaseAfterMs);
}

releaseButton.addEventListener("click", () => void releaseBuffers("button"));
void run().catch((error) => {
  void report("error", { message: error?.message || String(error) });
});
