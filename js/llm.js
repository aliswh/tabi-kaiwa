// On-device LLM via WebLLM (MLC) — runs fully client-side over WebGPU, no server, no API key.
// Pinned version for stability; bump deliberately if you want a newer runtime/model catalog.
const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.84";

// Preferred small models, best Japanese quality first. The actual available IDs depend on the
// WebLLM release's prebuilt catalog, so we filter this list against what's really available at
// runtime instead of hardcoding an ID that might not exist.
const PREFERRED_MODEL_IDS = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2-1.5B-Instruct-q4f16_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2-0.5B-Instruct-q4f16_1-MLC",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
];

let webllm = null;
let engine = null;
let loadedModelId = null;

export function isWebGPUSupported() {
  return "gpu" in navigator;
}

async function getWebLLM() {
  if (!webllm) {
    webllm = await import(/* webpackIgnore: true */ WEBLLM_URL);
  }
  return webllm;
}

/** Returns [{id, vramMB}] for models worth offering in Settings, smallest first. */
export async function listAvailableModels() {
  const lib = await getWebLLM();
  const all = lib.prebuiltAppConfig.model_list;
  const byId = new Map(all.map((m) => [m.model_id, m]));

  const preferred = PREFERRED_MODEL_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (preferred.length) return preferred.map(toOption);

  // Fallback: no preferred model matched this release's catalog — offer the smallest
  // instruct-ish models available so the app still works.
  return all
    .filter((m) => /instruct|it-q/i.test(m.model_id))
    .sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0))
    .slice(0, 8)
    .map(toOption);
}

function toOption(m) {
  return { id: m.model_id, vramMB: Math.round(m.vram_required_MB || 0) };
}

export function getLoadedModelId() {
  return loadedModelId;
}

/** Loads (or switches to) a model. onProgress({text, progress}) reports download/compile status. */
export async function initEngine(modelId, onProgress) {
  const lib = await getWebLLM();
  if (!engine) {
    engine = new lib.MLCEngine();
  }
  engine.setInitProgressCallback((p) => onProgress && onProgress(p));
  await engine.reload(modelId);
  loadedModelId = modelId;
  return engine;
}

/** messages: [{role:'system'|'user'|'assistant', content:string}] -> returns assistant text */
export async function chatComplete(messages) {
  if (!engine || !loadedModelId) {
    throw new Error("Model isn't loaded yet. Open Settings and tap “Apply / download model”.");
  }
  const reply = await engine.chat.completions.create({ messages });
  return reply.choices[0].message.content;
}

export async function unloadEngine() {
  if (engine) {
    try { await engine.unload(); } catch (_) {}
  }
  engine = null;
  loadedModelId = null;
}
