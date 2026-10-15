const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isRecognitionSupported() {
  return !!SpeechRecognitionImpl;
}

export function isSynthesisSupported() {
  return "speechSynthesis" in window;
}

let recognizer = null;

/**
 * Starts one-shot Japanese speech recognition.
 * onResult(transcript) fires once on success. onEnd() always fires when listening stops.
 */
export function startListening({ onResult, onError, onEnd }) {
  if (!isRecognitionSupported()) {
    onError && onError(new Error("Speech recognition isn't supported in this browser."));
    return null;
  }
  if (recognizer) {
    try { recognizer.abort(); } catch (_) {}
  }
  recognizer = new SpeechRecognitionImpl();
  recognizer.lang = "ja-JP";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    onResult && onResult(transcript);
  };
  recognizer.onerror = (event) => {
    onError && onError(new Error(event.error || "Speech recognition error"));
  };
  recognizer.onend = () => {
    onEnd && onEnd();
  };

  recognizer.start();
  return recognizer;
}

export function stopListening() {
  if (recognizer) {
    try { recognizer.stop(); } catch (_) {}
  }
}

let japaneseVoice = null;
function pickJapaneseVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ja")) || null;
}

if (isSynthesisSupported()) {
  japaneseVoice = pickJapaneseVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    japaneseVoice = pickJapaneseVoice();
  };
}

export function speak(text) {
  if (!isSynthesisSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  if (japaneseVoice) utter.voice = japaneseVoice;
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}
