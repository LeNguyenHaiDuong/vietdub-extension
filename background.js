/**
 * VietDub - Chrome Extension Background Service Worker
 * Handles CORS-free background translation, TTS proxying & state persistence
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
      ttsEngine: 'web-speech',   // 'web-speech' (Built-in) or 'google-tts' (Direct Stream)
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
    if (translationCache.size > 1500) {
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
 * Message Dispatcher for Content Scripts & Popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRANSLATE_TEXT') {
    translateToVietnamese(request.text)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

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
