/**
 * VietDub - Chrome Extension Background Service Worker
 * Features:
 * 1. Studio-grade Microsoft Edge Neural Voices (vi-VN-HoaiMyNeural, vi-VN-NamMinhNeural)
 * 2. Optional OpenAI TTS API integration (Nova, Alloy, Shimmer...)
 * 3. DeclarativeNetRequest spoofing for 24kHz HD Edge TTS WebSocket
 * 4. Zero-CORS Google Translate proxy & translation cache
 */

const WIN_EPOCH = 11644473600n;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = '143';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const EDGE_RULE_ID = 1001;

// -----------------------------------------------------------------------------
// 1. Setup DeclarativeNetRequest Rules for Edge Neural TTS Handshake
// -----------------------------------------------------------------------------
async function setupDeclarativeRules() {
  try {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [EDGE_RULE_ID],
        addRules: [
          {
            id: EDGE_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                {
                  header: 'User-Agent',
                  operation: 'set',
                  value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`
                },
                {
                  header: 'Origin',
                  operation: 'set',
                  value: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
                }
              ]
            },
            condition: {
              urlFilter: 'wss://speech.platform.bing.com/*',
              resourceTypes: ['websocket']
            }
          }
        ]
      });
      console.log('[VietDub] Edge TTS declarative rules registered successfully');
    }
  } catch (err) {
    console.warn('[VietDub] DeclarativeNetRequest setup warning:', err);
  }
}

// Register on install and startup
chrome.runtime.onInstalled.addListener(() => {
  setupDeclarativeRules();

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
    'openaiApiKey',
    'openaiVoice',
    'statsTranslatedCues'
  ], (res) => {
    const defaults = {
      enabled: true,
      showSubtitles: true,
      dubbingVolume: 1.0,
      duckingRatio: 0.25,        // Lower video sound to 25% when Vietnamese voice speaks
      speechRate: 1.05,
      autoRate: true,            // Automatically sync speech speed to subtitle line duration
      selectedVoice: 'vi-VN-HoaiMyNeural', // Studio Grade Neural Voice as default
      ttsEngine: 'auto',         // 'auto' (Studio Edge Neural by default), 'edge-neural', 'openai', 'chrome-tts', 'google-stream'
      subtitlePosition: 'bottom',// 'bottom' or 'top'
      fontSize: 18,
      openaiApiKey: '',
      openaiVoice: 'nova',
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

chrome.runtime.onStartup.addListener(() => {
  setupDeclarativeRules();
});

// Run once immediately on worker initialization
setupDeclarativeRules();

// -----------------------------------------------------------------------------
// 2. Translation Engine & Memory Cache
// -----------------------------------------------------------------------------
const translationCache = new Map();
const audioCache = new Map(); // Audio bytes cache for instant replay

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeXml(unsafe) {
  return (unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

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

    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = data[0].map(segment => segment[0]).join('');
    }

    if (!translated) {
      translated = cleaned;
    }

    if (translationCache.size > 2000) {
      const firstKey = translationCache.keys().next().value;
      translationCache.delete(firstKey);
    }
    translationCache.set(cleaned, translated);

    chrome.storage.local.get(['statsTranslatedCues'], (res) => {
      const current = res.statsTranslatedCues || 0;
      chrome.storage.local.set({ statsTranslatedCues: current + 1 });
    });

    return translated;
  } catch (err) {
    console.warn('[VietDub Background] Translate failed:', err);
    return cleaned;
  }
}

// -----------------------------------------------------------------------------
// 3. Microsoft Edge Neural TTS Synthesis (24kHz HD Studio Audio)
// -----------------------------------------------------------------------------
async function generateSecMsGec() {
  const nowSec = Date.now() / 1000;
  let ticks = BigInt(Math.floor(nowSec));
  ticks += WIN_EPOCH;
  ticks -= ticks % 300n;
  ticks *= 10000000n; // 1e9 / 100 = 10,000,000 100-nanosecond ticks

  const strToHash = `${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(strToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateUuidHex() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function dateToString() {
  return new Date().toUTCString();
}

/**
 * Synthesize Vietnamese speech using Microsoft Edge Neural Studio Voices
 * Output: 24kHz 48kbps MP3 Audio (Uint8Array)
 */
async function synthesizeEdgeNeural(text, voice = 'vi-VN-HoaiMyNeural', rate = 1.05) {
  const secMsGec = await generateSecMsGec();
  const connId = generateUuidHex();
  const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connId}`;

  return new Promise((resolve, reject) => {
    let ws;
    let timeoutId;
    const audioChunks = [];

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch (_) {}
      }
    };

    // Timeout after 6.5s to fallback smoothly
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Edge Neural TTS WebSocket timed out'));
    }, 6500);

    try {
      ws = new WebSocket(wssUrl);
      ws.binaryType = 'arraybuffer';
    } catch (e) {
      cleanup();
      return reject(e);
    }

    ws.onopen = () => {
      // 1. Send speech.config
      const configMsg =
        `X-Timestamp:${dateToString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;

      ws.send(configMsg);

      // 2. Format rate prosody
      const ratePct = Math.round((rate - 1.0) * 100);
      const rateStr = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;

      // 3. Send SSML request
      const escaped = escapeXml(text);
      const chosenVoice = voice.includes('NamMinh') ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural';

      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${chosenVoice}'>` +
        `<prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>${escaped}</prosody>` +
        `</voice></speak>`;

      const reqMsg =
        `X-RequestId:${generateUuidHex()}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${dateToString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(reqMsg);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const buf = event.data;
        if (buf.byteLength > 2) {
          const view = new DataView(buf);
          const headerLen = view.getUint16(0, false);
          if (buf.byteLength > 2 + headerLen) {
            const audioData = new Uint8Array(buf, 2 + headerLen);
            audioChunks.push(audioData);
          }
        }
      } else if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          cleanup();
          if (audioChunks.length === 0) {
            return reject(new Error('Edge Neural TTS returned zero audio bytes'));
          }

          // Merge all audio chunks into a single Uint8Array
          const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(merged);
        }
      }
    };

    ws.onerror = (err) => {
      cleanup();
      reject(new Error('Edge Neural TTS WebSocket error: ' + (err.message || 'connection failed')));
    };

    ws.onclose = () => {
      // If closed before turn.end and we didn't receive audio
      if (audioChunks.length === 0) {
        cleanup();
        reject(new Error('Edge Neural TTS WebSocket closed prematurely'));
      }
    };
  });
}

// -----------------------------------------------------------------------------
// 4. OpenAI TTS API (Optional Custom Key)
// -----------------------------------------------------------------------------
async function synthesizeOpenAITTS(text, apiKey, voice = 'nova', rate = 1.05) {
  const speed = Math.min(Math.max(rate, 0.75), 1.5);
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: voice || 'nova',
      speed: speed
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS API error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// -----------------------------------------------------------------------------
// 5. Universal Google Stream Fallback (16kHz standard)
// -----------------------------------------------------------------------------
async function fetchLegacyGoogleTTS(text) {
  const cleaned = cleanText(text);
  if (!cleaned) throw new Error('Empty text for TTS');

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(cleaned)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });

  if (!response.ok) {
    throw new Error(`Legacy Google TTS stream error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Helper: Safely convert large Uint8Array to base64
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

/**
 * Master Studio Audio Dispatcher
 * Priority: OpenAI (if enabled) -> Microsoft Edge Neural Studio -> Google Fallback
 */
async function getTTSAudioBase64(text, options = {}) {
  const cleaned = cleanText(text);
  if (!cleaned) throw new Error('Empty text');

  const voiceName = options.voiceName || 'vi-VN-HoaiMyNeural';
  const rate = options.rate || 1.05;
  const cacheKey = `${voiceName}:${rate.toFixed(2)}:${cleaned}`;

  if (audioCache.has(cacheKey)) {
    return { audioBase64: audioCache.get(cacheKey), serverRateApplied: true };
  }

  // Get user settings
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(['ttsEngine', 'openaiApiKey', 'openaiVoice'], resolve);
  });

  let audioBytes = null;
  let serverRateApplied = true;

  // 1. OpenAI TTS if explicitly configured with API Key
  if (settings.ttsEngine === 'openai' && settings.openaiApiKey) {
    try {
      console.log('[VietDub Background] Synthesizing via OpenAI TTS...');
      audioBytes = await synthesizeOpenAITTS(cleaned, settings.openaiApiKey, settings.openaiVoice, rate);
    } catch (e) {
      console.warn('[VietDub Background] OpenAI TTS failed, falling back to Edge Neural:', e);
    }
  }

  // 2. Microsoft Edge Neural Voice (Studio 24kHz - Default & Premier Free Engine)
  if (!audioBytes && settings.ttsEngine !== 'google-stream') {
    try {
      console.log('[VietDub Background] Synthesizing via Edge Neural Studio Voice:', voiceName);
      audioBytes = await synthesizeEdgeNeural(cleaned, voiceName, rate);
    } catch (e) {
      console.warn('[VietDub Background] Edge Neural TTS failed, trying legacy Google stream:', e);
    }
  }

  // 3. Fallback to Legacy Google Stream if needed
  if (!audioBytes) {
    console.log('[VietDub Background] Using fallback Google audio stream');
    audioBytes = await fetchLegacyGoogleTTS(cleaned);
    serverRateApplied = false; // Legacy stream doesn't bake rate into audio
  }

  const audioBase64 = uint8ArrayToBase64(audioBytes);

  // Cache up to 250 phrases
  if (audioCache.size > 250) {
    const first = audioCache.keys().next().value;
    audioCache.delete(first);
  }
  audioCache.set(cacheKey, audioBase64);

  return { audioBase64, serverRateApplied };
}

// -----------------------------------------------------------------------------
// 6. Message Dispatcher for Content Scripts & Popup
// -----------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Translation
  if (request.action === 'TRANSLATE_TEXT') {
    translateToVietnamese(request.text)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. Batch pre-fetch
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

  // 3. Master Studio Audio Fetch (Web Audio API Stream)
  if (request.action === 'FETCH_TTS_AUDIO') {
    getTTSAudioBase64(request.text, { voiceName: request.voiceName, rate: request.rate })
      .then(({ audioBase64, serverRateApplied }) => {
        sendResponse({ success: true, audioBase64, serverRateApplied });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 4. Native chrome.tts API speak (for system voices)
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

  // 5. Stop native chrome.tts
  if (request.action === 'STOP_CHROME_TTS') {
    try {
      chrome.tts.stop();
    } catch (_) {}
    sendResponse({ success: true });
    return true;
  }

  // 6. Get available voices (Always include premier Edge Neural Studio voices!)
  if (request.action === 'GET_CHROME_TTS_VOICES') {
    chrome.tts.getVoices((chromeVoices) => {
      const list = [
        {
          voiceName: 'vi-VN-HoaiMyNeural',
          lang: 'vi-VN',
          isNeural: true,
          gender: 'Female',
          displayName: '🌟 Hoài My (Nữ - Truyền cảm, tự nhiên VTV)'
        },
        {
          voiceName: 'vi-VN-NamMinhNeural',
          lang: 'vi-VN',
          isNeural: true,
          gender: 'Male',
          displayName: '🌟 Nam Minh (Nam - Trầm ấm, chuyên nghiệp)'
        }
      ];

      if (Array.isArray(chromeVoices)) {
        const viVoices = chromeVoices.filter(v =>
          (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
          (v.voiceName && v.voiceName.toLowerCase().includes('vietnam'))
        );
        viVoices.forEach(v => {
          if (!list.some(item => item.voiceName === v.voiceName)) {
            list.push({
              voiceName: v.voiceName,
              lang: v.lang || 'vi-VN',
              isNativeChrome: true,
              displayName: `🖥️ ${v.voiceName} (Hệ thống)`
            });
          }
        });
      }

      sendResponse({ voices: list });
    });
    return true;
  }

  // 7. Clear cache
  if (request.action === 'CLEAR_CACHE') {
    translationCache.clear();
    audioCache.clear();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'PING') {
    sendResponse({ status: 'PONG', version: '2.0.0', engine: 'EdgeNeural-24kHz' });
    return true;
  }
});
