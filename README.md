# Tabi Kaiwa

A personal, phone-installable PWA for practicing simple travel Japanese conversations against
an on-device AI partner. No servers, no API keys, no subscription:

- The AI ("Mochi"-style role-play partner) runs **entirely in the browser** via
  [WebLLM](https://github.com/mlc-ai/web-llm) + WebGPU, using a small open-source model
  (Qwen2.5-1.5B-Instruct by default). First load downloads ~1GB once; after that it's offline.
- Speech recognition and text-to-speech use the browser's built-in **Web Speech API** — free,
  no extra install.
- Your vocab deck, streak, and settings are saved to **your own Google Drive** (a hidden,
  app-only folder — it won't show up in your normal Drive), via "Sign in with Google". A
  local copy is also cached on-device so the app still works without a connection.

This is a static site: `index.html` + plain JS, no build step, no backend.

## 1. One-time: create a Google OAuth Client ID (for Drive sync)

This step is yours to do (it's your Google account) — it takes about 5 minutes and is free:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project
   (any name, e.g. "Tabi Kaiwa").
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External. App name: anything. Your email for support/contact.
   - Scopes: you can skip adding scopes here (the app requests `drive.appdata` at sign-in).
   - **Test users**: add your own Google account email. Leave "Publishing status" as **Testing** —
     that's fine for personal use with just you as a user.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add the URL you'll deploy to, e.g.
     `https://<your-github-username>.github.io` (see step 3 below). You can add
     `http://localhost:5173` (or whichever port) too, for local testing.
5. Copy the generated Client ID (looks like `xxxxx.apps.googleusercontent.com`).
6. In the app, go to **Settings → Google Drive sync**, paste it in, tap **Save Client ID**, then
   **Sign in with Google**.

The Client ID is not a secret (it's meant to be public in client-side apps) — it's safe to have
it in the deployed code.

## 2. Try it locally first

From this folder:

```bash
npx serve .
```

Open the printed `http://localhost:...` URL in Chrome. Note: on desktop Chrome, WebGPU usually
works, but speech recognition needs a real microphone, and the model load is the same ~1GB
download it'll do on your phone.

## 3. Deploy to GitHub Pages (free, gives you an HTTPS URL for your phone)

HTTPS is required for microphone access and for installing as a home-screen app, which is why
this isn't just opened as a local file.

```bash
# from inside this tabi-kaiwa/ folder
git init
git add .
git commit -m "Tabi Kaiwa"
gh repo create tabi-kaiwa --public --source=. --remote=origin --push
gh api -X POST repos/:owner/tabi-kaiwa/pages -f "source[branch]=main" -f "source[path]=/" 2>/dev/null \
  || gh api -X PUT repos/:owner/tabi-kaiwa/pages -f "source[branch]=main" -f "source[path]=/"
```

GitHub will serve it at `https://<your-username>.github.io/tabi-kaiwa/` within a minute or two.
(The repo is public, like most personal GitHub Pages sites — anyone with the exact link could
view the code, but there's no personal data in it; your vocab/streak live only in your own
Google Drive, gated by your Google sign-in.)

Add that URL as an **Authorized JavaScript origin** in step 1.4 above if you hadn't already.

## 4. On your Pixel 10 Pro

1. Open the GitHub Pages URL in **Chrome**.
2. Go to **Settings → On-device AI model**, pick a model, tap **Apply / download model** (needs
   WiFi the first time — downloads once, then it's cached).
3. Chrome's menu → **Add to Home screen** / **Install app**.
4. Grant microphone access when prompted (needed for speaking practice).
5. Go to **Settings → Google Drive sync**, sign in, so your progress is backed up.
6. Turn on airplane mode / WiFi off and reopen the app from the home screen — it should still
   launch and let you chat (the Google sign-in / sync just won't refresh until you're back online).

## Notes & limits

- WebGPU support on Android Chrome is what makes the on-device model possible — this needs a
  reasonably current Chrome. If a scenario won't start, Settings will say WebGPU isn't supported.
- Speech recognition language is fixed to Japanese (`ja-JP`); typing always works as a fallback.
- The small open-source model is nowhere near as fluent as a large cloud model — expect simple,
  sometimes repetitive conversations. That's the trade-off for running fully offline and free.
- Google's OAuth consent screen in "Testing" mode works indefinitely for the test users you add
  (just you) — no need to submit it for verification for personal use.
