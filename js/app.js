import { SCENARIOS, getScenarioPrompt, customScenario } from "./scenarios.js";
import * as speech from "./speech.js";
import * as llm from "./llm.js";
import * as drive from "./drive.js";

const LOCAL_CACHE_KEY = "tabiKaiwaLocalCache";
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30];

const state = {
  difficulty: "basic",
  autoplay: true,
  modelId: null,
  vocab: [],          // {id, japanese, reading, english, level, nextReview}
  streakDates: [],     // ["YYYY-MM-DD", ...]
  scenarioSessions: 0, // total practice sessions started
  signedIn: false,
};

let availableModels = [];
let webgpuOK = llm.isWebGPUSupported();

let chat = null; // { scenario, llmMessages: [...], uiMessages: [...] }
let reviewQueue = [];
let reviewIndex = 0;

// ---------- small utils ----------

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
function toast(message, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------- persistence ----------

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(state, {
      difficulty: data.difficulty || state.difficulty,
      autoplay: data.autoplay !== undefined ? data.autoplay : state.autoplay,
      modelId: data.modelId || null,
      vocab: Array.isArray(data.vocab) ? data.vocab : [],
      streakDates: Array.isArray(data.streakDates) ? data.streakDates : [],
      scenarioSessions: data.scenarioSessions || 0,
    });
  } catch (_) {}
}

function snapshot() {
  return {
    difficulty: state.difficulty,
    autoplay: state.autoplay,
    modelId: state.modelId,
    vocab: state.vocab,
    streakDates: state.streakDates,
    scenarioSessions: state.scenarioSessions,
  };
}

function applySnapshot(data) {
  if (!data) return;
  Object.assign(state, {
    difficulty: data.difficulty || state.difficulty,
    autoplay: data.autoplay !== undefined ? data.autoplay : state.autoplay,
    modelId: data.modelId || state.modelId,
    vocab: Array.isArray(data.vocab) ? data.vocab : state.vocab,
    streakDates: Array.isArray(data.streakDates) ? data.streakDates : state.streakDates,
    scenarioSessions: data.scenarioSessions || state.scenarioSessions,
  });
}

function persistLocal() {
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(snapshot()));
}

let remoteSaveTimer = null;
function persistRemoteDebounced() {
  if (!state.signedIn) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    drive.saveData(snapshot()).catch((err) => toast("Drive sync failed: " + err.message));
  }, 800);
}

function persist() {
  persistLocal();
  persistRemoteDebounced();
  renderHome();
}

// ---------- view switching ----------

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll("nav.tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

document.querySelectorAll("nav.tabbar button").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---------- home view ----------

function computeStreak() {
  const set = new Set(state.streakDates);
  let streak = 0;
  const d = new Date();
  if (!set.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (set.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function markPracticedToday() {
  const today = todayISO();
  if (!state.streakDates.includes(today)) {
    state.streakDates.push(today);
  }
}

function renderHome() {
  const streak = computeStreak();
  document.getElementById("streak-pill").textContent = `🔥 ${streak} day${streak === 1 ? "" : "s"} streak`;
  document.getElementById("home-streak").textContent = `${streak} day${streak === 1 ? "" : "s"}`;
  document.getElementById("home-streak-sub").textContent =
    streak > 0 ? "Keep it going — practice again today!" : "Practice today to start a streak.";
  document.getElementById("home-vocab-count").textContent = state.vocab.length;
  document.getElementById("home-scenario-count").textContent = state.scenarioSessions;

  const syncStatus = document.getElementById("home-sync-status");
  const signinBtn = document.getElementById("home-signin-btn");
  if (state.signedIn) {
    syncStatus.textContent = "Connected — your progress is backed up to Google Drive.";
    signinBtn.style.display = "none";
  } else {
    syncStatus.textContent = "Not connected. Your progress will only last on this device/browser.";
    signinBtn.style.display = "block";
  }
}

document.getElementById("home-practice-btn").addEventListener("click", () => switchView("scenarios"));
document.getElementById("home-signin-btn").addEventListener("click", handleSignInClick);

// ---------- scenarios view ----------

function renderScenarioWebGpuWarning() {
  if (webgpuOK) return;
  const grid = document.getElementById("scenario-grid");
  const warn = document.createElement("div");
  warn.className = "card";
  warn.style.gridColumn = "1 / -1";
  warn.innerHTML =
    "<h2>Not available</h2><p class='muted'>This browser doesn't support WebGPU, so the on-device AI can't run here. On the Pixel, open this app in Chrome and make sure it's up to date.</p>";
  grid.parentElement.insertBefore(warn, grid);
}

function renderScenarios() {
  const grid = document.getElementById("scenario-grid");
  grid.innerHTML = "";
  SCENARIOS.forEach((sc) => {
    const btn = document.createElement("button");
    btn.className = "scenario-card";
    btn.innerHTML = `<span class="emoji">${sc.emoji}</span><div class="title">${escapeHtml(sc.title)}</div><div class="sub">${escapeHtml(sc.sub)}</div>`;
    btn.addEventListener("click", () => startScenario(sc));
    grid.appendChild(btn);
  });
}

document.getElementById("custom-scenario-btn").addEventListener("click", () => {
  const text = document.getElementById("custom-scenario-input").value.trim();
  if (!text) {
    toast("Describe the situation first.");
    return;
  }
  startScenario(customScenario(text));
});

// ---------- chat view ----------

function renderChatLog() {
  const log = document.getElementById("chat-log");
  log.innerHTML = "";
  chat.uiMessages.forEach((m) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${m.role === "user" ? "user" : "ai"}`;
    if (m.role === "user") {
      bubble.textContent = m.text;
    } else {
      const jpLine = document.createElement("div");
      jpLine.className = "jp-line";
      const jp = document.createElement("span");
      jp.textContent = m.jp || m.raw;
      jpLine.appendChild(jp);
      if (speech.isSynthesisSupported()) {
        const speakBtn = document.createElement("button");
        speakBtn.className = "speak-btn";
        speakBtn.textContent = "🔊";
        speakBtn.addEventListener("click", () => speech.speak(m.jp || m.raw));
        jpLine.appendChild(speakBtn);
      }
      bubble.appendChild(jpLine);
      if (m.en) {
        const en = document.createElement("div");
        en.className = "en";
        en.textContent = m.en;
        bubble.appendChild(en);
      }
      if (m.tip) {
        const tip = document.createElement("div");
        tip.className = "tip";
        tip.textContent = "💡 " + m.tip;
        bubble.appendChild(tip);
      }
    }
    log.appendChild(bubble);
  });
  log.scrollTop = log.scrollHeight;
}

function parseAiReply(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const jp = [];
  let en = "";
  let tip = "";
  for (const line of lines) {
    if (/^EN:/i.test(line)) en = line.replace(/^EN:/i, "").trim();
    else if (/^TIP:/i.test(line)) tip = line.replace(/^TIP:/i, "").trim();
    else if (!en && !tip) jp.push(line);
  }
  return { jp: jp.join(" "), en, tip };
}

function setChatBusy(busy, statusText) {
  document.getElementById("chat-send-btn").disabled = busy;
  document.getElementById("chat-text-input").disabled = busy;
  document.getElementById("mic-btn").disabled = busy;
  if (statusText !== undefined) document.getElementById("chat-engine-status").textContent = statusText;
}

async function ensureModelLoaded() {
  if (llm.getLoadedModelId() === state.modelId && state.modelId) return;
  if (!availableModels.length) availableModels = await llm.listAvailableModels();
  if (!state.modelId) state.modelId = availableModels[0] && availableModels[0].id;
  if (!state.modelId) throw new Error("No on-device model is available in this WebLLM build.");

  const progressWrap = document.getElementById("chat-progress-wrap");
  const progressFill = document.getElementById("chat-progress-fill");
  progressWrap.style.display = "block";
  setChatBusy(true, "Downloading/loading model…");
  await llm.initEngine(state.modelId, (p) => {
    const pct = Math.round((p.progress || 0) * 100);
    progressFill.style.width = pct + "%";
    setChatBusy(true, p.text || `Loading… ${pct}%`);
  });
  progressWrap.style.display = "none";
  setChatBusy(false, "Ready");
}

async function startScenario(scenario) {
  if (!webgpuOK) {
    toast("This browser can't run the on-device AI (no WebGPU support).");
    return;
  }
  chat = {
    scenario,
    llmMessages: [{ role: "system", content: getScenarioPrompt(scenario, state.difficulty) }],
    uiMessages: [],
  };
  state.scenarioSessions += 1;
  persist();

  document.getElementById("chat-scenario-title").textContent = `${scenario.emoji} ${scenario.title}`;
  document.getElementById("chat-log").innerHTML = "";
  switchView("chat");

  try {
    await ensureModelLoaded();
  } catch (err) {
    toast(err.message);
    return;
  }

  chat.llmMessages.push({ role: "user", content: "(The user has just arrived. Greet them in character and start the scenario with a short opening line.)" });
  setChatBusy(true, "Thinking…");
  try {
    const raw = await llm.chatComplete(chat.llmMessages);
    chat.llmMessages.push({ role: "assistant", content: raw });
    const parsed = parseAiReply(raw);
    chat.uiMessages.push({ role: "ai", raw, ...parsed });
    renderChatLog();
    if (state.autoplay) speech.speak(parsed.jp || raw);
  } catch (err) {
    toast("Model error: " + err.message);
  } finally {
    setChatBusy(false, "Ready");
  }
}

async function sendMessage(text) {
  if (!text.trim() || !chat) return;
  chat.uiMessages.push({ role: "user", text });
  chat.llmMessages.push({ role: "user", content: text });
  renderChatLog();
  document.getElementById("chat-text-input").value = "";
  setChatBusy(true, "Thinking…");
  try {
    const raw = await llm.chatComplete(chat.llmMessages);
    chat.llmMessages.push({ role: "assistant", content: raw });
    const parsed = parseAiReply(raw);
    chat.uiMessages.push({ role: "ai", raw, ...parsed });
    renderChatLog();
    if (state.autoplay) speech.speak(parsed.jp || raw);
    markPracticedToday();
    persist();
  } catch (err) {
    toast("Model error: " + err.message);
  } finally {
    setChatBusy(false, "Ready");
  }
}

document.getElementById("chat-send-btn").addEventListener("click", () => {
  sendMessage(document.getElementById("chat-text-input").value);
});
document.getElementById("chat-text-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage(e.currentTarget.value);
});
document.getElementById("chat-end-btn").addEventListener("click", () => {
  chat = null;
  switchView("scenarios");
});

const micBtn = document.getElementById("mic-btn");
let listening = false;
micBtn.addEventListener("click", () => {
  if (!speech.isRecognitionSupported()) {
    toast("Speech recognition isn't supported in this browser — type instead.");
    return;
  }
  if (listening) {
    speech.stopListening();
    return;
  }
  listening = true;
  micBtn.classList.add("listening");
  speech.startListening({
    onResult: (transcript) => {
      document.getElementById("chat-text-input").value = transcript;
    },
    onError: (err) => toast("Mic error: " + err.message),
    onEnd: () => {
      listening = false;
      micBtn.classList.remove("listening");
    },
  });
});

document.getElementById("save-vocab-btn").addEventListener("click", extractVocabFromChat);

async function extractVocabFromChat() {
  if (!chat || !chat.uiMessages.length) {
    toast("Have a short conversation first.");
    return;
  }
  const transcript = chat.uiMessages
    .map((m) => (m.role === "user" ? `User: ${m.text}` : `AI: ${m.jp || m.raw}${m.en ? " (" + m.en + ")" : ""}`))
    .join("\n");

  const extractMessages = [
    {
      role: "system",
      content:
        'You extract vocabulary for a Japanese language learner. Given a conversation transcript, output ONLY a JSON array (no markdown fences, no extra text) of up to 8 useful words or short phrases from it, each shaped like {"japanese":"...","reading":"...","english":"..."}. Pick words/phrases a tourist should remember. If nothing useful, output [].',
    },
    { role: "user", content: transcript },
  ];

  toast("Looking for new words…");
  try {
    await ensureModelLoaded();
    const raw = await llm.chatComplete(extractMessages);
    const jsonText = raw.replace(/```json|```/gi, "").trim();
    const items = JSON.parse(jsonText);
    let added = 0;
    for (const item of items) {
      if (!item || !item.japanese) continue;
      const exists = state.vocab.some((v) => v.japanese === item.japanese);
      if (exists) continue;
      state.vocab.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        japanese: item.japanese,
        reading: item.reading || "",
        english: item.english || "",
        level: 0,
        nextReview: todayISO(),
      });
      added++;
    }
    persist();
    renderVocabList();
    toast(added ? `Saved ${added} new word${added === 1 ? "" : "s"}!` : "No new words found this time.");
  } catch (err) {
    toast("Couldn't extract vocab: " + err.message);
  }
}

// ---------- vocab view ----------

function renderVocabList() {
  const list = document.getElementById("vocab-list");
  list.innerHTML = "";
  if (!state.vocab.length) {
    list.innerHTML = '<p class="muted center-text">No vocabulary yet — save words after a chat.</p>';
    return;
  }
  const sorted = [...state.vocab].sort((a, b) => a.japanese.localeCompare(b.japanese, "ja"));
  sorted.forEach((v) => {
    const row = document.createElement("div");
    row.className = "vocab-row";
    row.innerHTML = `
      <div>
        <div>${escapeHtml(v.japanese)} <span class="muted">${escapeHtml(v.reading)}</span></div>
        <div class="muted">${escapeHtml(v.english)}</div>
      </div>
      <span class="lvl">Lv.${v.level}</span>
    `;
    list.appendChild(row);
  });
}

function dueCards() {
  const today = todayISO();
  return state.vocab.filter((v) => v.nextReview <= today);
}

document.getElementById("review-btn").addEventListener("click", () => {
  reviewQueue = dueCards();
  if (!reviewQueue.length) {
    toast("No cards due right now — nice work!");
    return;
  }
  reviewIndex = 0;
  document.getElementById("vocab-review-area").style.display = "block";
  document.getElementById("vocab-list").style.display = "none";
  renderFlashcard();
});

document.getElementById("review-exit-btn").addEventListener("click", exitReview);

function exitReview() {
  document.getElementById("vocab-review-area").style.display = "none";
  document.getElementById("vocab-list").style.display = "flex";
  renderVocabList();
}

function renderFlashcard() {
  const card = reviewQueue[reviewIndex];
  document.getElementById("fc-jp").textContent = card.japanese;
  document.getElementById("fc-reading").textContent = card.reading || "";
  const enEl = document.getElementById("fc-en");
  enEl.textContent = card.english;
  enEl.style.display = "none";
  document.getElementById("fc-reveal-row").style.display = "flex";
  document.getElementById("fc-grade-row").style.display = "none";
}

document.getElementById("fc-reveal-btn").addEventListener("click", () => {
  document.getElementById("fc-en").style.display = "block";
  document.getElementById("fc-reveal-row").style.display = "none";
  document.getElementById("fc-grade-row").style.display = "flex";
});

document.getElementById("fc-speak-btn").addEventListener("click", () => {
  const card = reviewQueue[reviewIndex];
  if (card) speech.speak(card.japanese);
});

function gradeCard(correct) {
  const card = reviewQueue[reviewIndex];
  if (correct) {
    card.level = Math.min(card.level + 1, REVIEW_INTERVALS_DAYS.length - 1);
    card.nextReview = addDaysISO(REVIEW_INTERVALS_DAYS[card.level]);
  } else {
    card.level = 0;
    card.nextReview = todayISO();
  }
  persist();
  reviewIndex++;
  if (reviewIndex >= reviewQueue.length) {
    toast("Review complete! 🎉");
    exitReview();
  } else {
    renderFlashcard();
  }
}

document.getElementById("fc-got-btn").addEventListener("click", () => gradeCard(true));
document.getElementById("fc-miss-btn").addEventListener("click", () => gradeCard(false));

// ---------- settings view ----------

async function renderSettings() {
  const select = document.getElementById("model-select");
  if (!select.dataset.loaded) {
    select.innerHTML = '<option>Loading model list…</option>';
    try {
      availableModels = await llm.listAvailableModels();
      select.innerHTML = availableModels.map((m) => `<option value="${m.id}">${m.id} (~${m.vramMB}MB)</option>`).join("");
      select.dataset.loaded = "1";
      if (!state.modelId && availableModels.length) state.modelId = availableModels[0].id;
      if (state.modelId) select.value = state.modelId;
    } catch (err) {
      select.innerHTML = `<option>Couldn't load model list</option>`;
      toast("Couldn't reach the model catalog: " + err.message);
    }
  } else if (state.modelId) {
    select.value = state.modelId;
  }

  document.getElementById("model-size-hint").textContent = webgpuOK
    ? "Smaller models load faster and use less battery; larger ones understand more but take longer to download the first time."
    : "This browser doesn't support WebGPU — the on-device model can't run here.";

  document.getElementById("difficulty-select").value = state.difficulty;
  document.getElementById("autoplay-toggle").checked = state.autoplay;
  document.getElementById("google-client-id").value = drive.getStoredClientId();
  renderSyncStatus();
}

function renderSyncStatus() {
  const status = document.getElementById("settings-sync-status");
  const signinBtn = document.getElementById("settings-signin-btn");
  const signoutBtn = document.getElementById("settings-signout-btn");
  if (state.signedIn) {
    status.textContent = "Connected — progress syncs to your Google Drive (hidden app folder).";
    signinBtn.style.display = "none";
    signoutBtn.style.display = "block";
  } else {
    status.textContent = drive.getStoredClientId() ? "Client ID saved. Not signed in yet." : "Not connected.";
    signinBtn.style.display = "block";
    signoutBtn.style.display = "none";
  }
}

document.getElementById("model-reload-btn").addEventListener("click", async () => {
  const select = document.getElementById("model-select");
  const modelId = select.value;
  if (!modelId) return;
  state.modelId = modelId;
  persist();
  const btn = document.getElementById("model-reload-btn");
  btn.disabled = true;
  const hint = document.getElementById("model-size-hint");
  try {
    await llm.initEngine(modelId, (p) => {
      const pct = Math.round((p.progress || 0) * 100);
      hint.textContent = p.text || `Loading… ${pct}%`;
    });
    toast("Model ready!");
  } catch (err) {
    toast("Couldn't load model: " + err.message);
  } finally {
    btn.disabled = false;
    renderSettings();
  }
});

document.getElementById("difficulty-select").addEventListener("change", (e) => {
  state.difficulty = e.target.value;
  persist();
});

document.getElementById("autoplay-toggle").addEventListener("change", (e) => {
  state.autoplay = e.target.checked;
  persist();
});

document.getElementById("save-client-id-btn").addEventListener("click", () => {
  const value = document.getElementById("google-client-id").value.trim();
  if (!value) {
    toast("Paste your OAuth Client ID first.");
    return;
  }
  drive.setStoredClientId(value);
  toast("Saved. Tap “Sign in with Google” to connect.");
  renderSyncStatus();
});

async function handleSignInClick() {
  if (!drive.getStoredClientId()) {
    toast("Add your Google OAuth Client ID in Settings first.");
    switchView("settings");
    return;
  }
  try {
    await drive.signIn();
    state.signedIn = true;
    await pullFromDriveAndMerge();
    toast("Signed in! Syncing with Google Drive.");
  } catch (err) {
    toast("Sign-in failed: " + err.message);
  }
  renderSyncStatus();
  renderHome();
  renderVocabList();
}

document.getElementById("settings-signin-btn").addEventListener("click", handleSignInClick);
document.getElementById("settings-signout-btn").addEventListener("click", () => {
  drive.signOut();
  state.signedIn = false;
  renderSyncStatus();
  renderHome();
  toast("Signed out. Progress will stay on this device only.");
});

document.getElementById("clear-data-btn").addEventListener("click", () => {
  const ok = confirm("This clears your saved vocab, streak and settings (including from Google Drive if connected). Continue?");
  if (!ok) return;
  state.vocab = [];
  state.streakDates = [];
  state.scenarioSessions = 0;
  persist();
  renderHome();
  renderVocabList();
  toast("All data cleared.");
});

async function pullFromDriveAndMerge() {
  try {
    const data = await drive.loadData();
    if (data) {
      applySnapshot(data);
      persistLocal();
    } else {
      await drive.saveData(snapshot());
    }
  } catch (err) {
    toast("Couldn't sync with Drive: " + err.message);
  }
}

// ---------- boot ----------

async function boot() {
  loadLocalCache();
  renderScenarios();
  renderScenarioWebGpuWarning();
  renderVocabList();
  renderHome();
  switchView("home");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  if (drive.getStoredClientId()) {
    const ok = await drive.trySilentSignIn();
    if (ok) {
      state.signedIn = true;
      await pullFromDriveAndMerge();
      renderHome();
      renderVocabList();
    }
  }

  // Warm up the settings model list in the background so Settings opens instantly.
  llm.listAvailableModels().then((models) => (availableModels = models)).catch(() => {});
}

// Lazily (re)render Settings each time it's opened, since the model list / sync status can change.
const settingsNavBtn = document.querySelector('nav.tabbar button[data-view="settings"]');
settingsNavBtn.addEventListener("click", renderSettings);

boot();
