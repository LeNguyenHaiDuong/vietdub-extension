/**
 * VietDub - Chrome Extension Background Service Worker
 * Handles CORS-free background translation, native chrome.tts, Web Audio streaming & state
 */

// Initialize default settings on install or update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([
    'enabled',
    'showSubtitles',
    'dubbingVolume',
    'duckingRatio',
    'speechRate',
    'autoRate',
    'selectedVoice',
    'ttsEngine',
    'subtitlePosition',
    'fontSize',
    'statsTranslatedCues'
  ], (res) => {
    const defaults = {
      enabled: true,
      showSubtitles: true,
      dubbingVolume: 1.0,
      duckingRatio: 0.25,        // Lower video sound to 25% when Vietnamese voice speaks
      speechRate: 1.05,
      autoRate: true,            // Automatically sync speech speed to subtitle line duration
      selectedVoice: '',
      ttsEngine: 'auto',         // 'auto' (best available), 'chrome-tts', 'google-stream', 'web-speech'
      subtitlePosition: 'bottom',// 'bottom' or 'top'
      fontSize: 18,
      statsTranslatedCues: 0
    };

    const toUpdate = {};
    for (const [key, val] of Object.entries(defaults)) {
      if (res[key] === undefined) {
        toUpdate[key] = val;
      }
    }

    if (Object.keys(toUpdate).length > 0) {
      chrome.storage.local.set(toUpdate);
    }
  });
});

// Translation Cache in Service Worker memory
const translationCache = new Map();

/**
 * Clean & normalize text before sending to translation
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Free Google Translate API client (High speed, zero API key)
 */
async function translateToVietnamese(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return '';

  if (translationCache.has(cleaned)) {
    return translationCache.get(cleaned);
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(cleaned)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();
    let translated = '';

    // data[0] contains array of sentence pieces
    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = data[0].map(segment => segment[0]).join('');
    }

    if (!translated) {
      translated = cleaned;
    }

    // Keep cache size bounded
    if (translationCache.size > 2000) {
      const firstKey = translationCache.keys().next().value;
      translationCache.delete(firstKey);
    }
    translationCache.set(cleaned, translated);

    // Increment global stat
    chrome.storage.local.get(['statsTranslatedCues'], (res) => {
      const current = res.statsTranslatedCues || 0;
      chrome.storage.local.set({ statsTranslatedCues: current + 1 });
    });

    return translated;
  } catch (err) {
    console.warn('[VietDub Background] Translate failed:', err);
    return cleaned; // Fallback to original text
  }
}

/**
 * Fetch Google TTS audio as base64 to bypass all web page CSP & CORS restrictions
 */
async function fetchTTSAudioBase64(text) {
  const cleaned = cleanText(text);
  if (!cleaned) throw new Error('Empty text for TTS');

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(cleaned)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });

  if (!response.ok) {
    throw new Error(`TTS audio stream error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Message Dispatcher for Content Scripts & Popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Single text translation
  if (request.action === 'TRANSLATE_TEXT') {
    translateToVietnamese(request.text)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. Batch pre-fetch translation for upcoming cues
  if (request.action === 'PREFETCH_TRANSLATIONS') {
    if (Array.isArray(request.texts)) {
      Promise.all(request.texts.map(t => translateToVietnamese(t)))
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
    } else {
      sendResponse({ success: true });
    }
    return true;
  }

  // 3. Native chrome.tts API speak
  if (request.action === 'SPEAK_CHROME_TTS') {
    const opts = {
      lang: 'vi-VN',
      rate: Math.min(Math.max(request.rate || 1.0, 0.7), 1.8),
      volume: request.volume !== undefined ? request.volume : 1.0,
      onEvent: (event) => {
        if (sender.tab && sender.tab.id) {
          if (event.type === 'start') {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'TTS_AUDIO_START' }).catch(() => {});
          } else if (event.type === 'end' || event.type === 'error' || event.type === 'cancelled' || event.type === 'interrupted') {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'TTS_AUDIO_END' }).catch(() => {});
          }
        }
      }
    };

    if (request.voiceName) {
      opts.voiceName = request.voiceName;
    }

    try {
      chrome.tts.speak(request.text, opts);
      sendResponse({ success: true });
    } catch (e) {
      console.warn('[VietDub] chrome.tts error:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }

  // 4. Stop native chrome.tts
  if (request.action === 'STOP_CHROME_TTS') {
    try {
      chrome.tts.stop();
    } catch (_) {}
    sendResponse({ success: true });
    return true;
  }

  // 5. Get native Chrome TTS voices
  if (request.action === 'GET_CHROME_TTS_VOICES') {
    chrome.tts.getVoices((voices) => {
      sendResponse({ voices: voices || [] });
    });
    return true;
  }

  // 6. Fetch Google TTS audio as base64 (CSP-immune Web Audio stream)
  if (request.action === 'FETCH_TTS_AUDIO') {
    fetchTTSAudioBase64(request.text)
      .then(audioBase64 => sendResponse({ success: true, audioBase64 }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 7. Clear cache
  if (request.action === 'CLEAR_CACHE') {
    translationCache.clear();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'PING') {
    sendResponse({ status: 'PONG', version: '1.0.0' });
    return true;
  }
});
