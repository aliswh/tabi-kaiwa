// Google sign-in (Google Identity Services) + storing app data in the user's own
// Google Drive, in the hidden "appDataFolder" (visible only to this app, not cluttering
// their normal Drive). No backend, no secret — the OAuth Client ID is not sensitive.

const CLIENT_ID_KEY = "tabiKaiwaGoogleClientId"; // app config, not user data
const DATA_FILE_NAME = "tabi-kaiwa-data.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let cachedFileId = null;

export function getStoredClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || "";
}

export function setStoredClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
  tokenClient = null; // force re-init with the new client id
}

function waitForGoogleIdentity(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve(window.google);
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Google sign-in script failed to load (check your connection)."));
      } else {
        setTimeout(poll, 150);
      }
    })();
  });
}

async function ensureTokenClient() {
  const clientId = getStoredClientId();
  if (!clientId) throw new Error("No Google OAuth Client ID set. Add one in Settings.");
  const google = await waitForGoogleIdentity();
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: () => {}, // overridden per-call below
    });
  }
  return tokenClient;
}

function requestToken(promptMode) {
  return new Promise(async (resolve, reject) => {
    const client = await ensureTokenClient().catch(reject);
    if (!client) return;
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3000) * 1000 - 30000;
      resolve(accessToken);
    };
    client.error_callback = (err) => reject(new Error(err.message || "Google sign-in failed or was cancelled."));
    client.requestAccessToken({ prompt: promptMode });
  });
}

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

/** Interactive sign-in (shows the Google account picker/consent). */
export function signIn() {
  return requestToken("consent");
}

/** Silent attempt to restore a session without showing UI; resolves false (not throws) if it can't. */
export async function trySilentSignIn() {
  try {
    await requestToken("");
    return true;
  } catch (_) {
    return false;
  }
}

export function signOut() {
  if (accessToken && window.google) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  cachedFileId = null;
}

async function ensureToken() {
  if (isSignedIn()) return accessToken;
  return requestToken("");
}

async function findDataFileId(token) {
  if (cachedFileId) return cachedFileId;
  const url =
    "https://www.googleapis.com/drive/v3/files" +
    `?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${DATA_FILE_NAME}'`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const json = await res.json();
  if (json.files && json.files.length) {
    cachedFileId = json.files[0].id;
    return cachedFileId;
  }
  return null;
}

async function createDataFile(token, data) {
  const metadata = { name: DATA_FILE_NAME, parents: ["appDataFolder"] };
  const boundary = "tabikaiwa-" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`);
  const json = await res.json();
  cachedFileId = json.id;
  return cachedFileId;
}

/** Loads saved app data, or null if signed out / nothing saved yet. */
export async function loadData() {
  const token = await ensureToken();
  const fileId = await findDataFileId(token);
  if (!fileId) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive read failed (${res.status})`);
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/** Saves app data (vocab, streakDates, settings) to the user's Drive appDataFolder. */
export async function saveData(data) {
  const token = await ensureToken();
  let fileId = await findDataFileId(token);
  if (!fileId) {
    fileId = await createDataFile(token, data);
    return;
  }
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Drive save failed (${res.status})`);
}
