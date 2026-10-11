/**
 * VietDub - Text-To-Speech (TTS) Orchestration Engine
 * Multi-Engine Architecture:
 * 1. Microsoft Edge Neural HD Studio Stream (vi-VN-HoaiMyNeural, vi-VN-NamMinhNeural) [Default]
 * 2. OpenAI TTS Stream (Custom Key)
 * 3. Native Chrome TTS / Web Speech API
 * 4. Google Translate Stream Fallback
 * All played with CSP-immune Web Audio API & Audio Ducking
 */

class VietDubTTSEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      volume: 1.0,
      duckingRatio: 0.25,
      rate: 1.05,
      autoRate: true,
      selectedVoiceName: 'vi-VN-HoaiMyNeural',
      ttsEngine: 'auto' // 'auto', 'edge-neural', 'openai', 'chrome-tts', 'google-stream', 'web-speech'
    }, options);

    this.voices = [];
    this.isPlaying = false;
    this.audioCtx = null;
    this.currentSourceNode = null;
    this.audioUnlockBound = false;

    // Callbacks for Audio Ducking in content.js
    this.onSpeechStart = null;
    this.onSpeechEnd = null;

    this.initAudioContext();
    this.initVoices();
    this.initRuntimeListeners();
  }

  /**
   * Initialize Web Audio API context (Safe from page CSP)
   */
  initAudioContext() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass && (!this.audioCtx || this.audioCtx.state === 'closed')) {
        this.audioCtx = new AudioCtxClass();
      }
    } catch (e) {
      console.warn('[VietDub] AudioContext init warning:', e);
    }

    // Unlock AudioContext on first user interaction
    const unlock = () => {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().then(() => {
          console.log('[VietDub] AudioContext unlocked successfully');
        }).catch(() => {});
      }
      if (window.speechSynthesis && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    };

    if (!this.audioUnlockBound) {
      document.addEventListener('click', unlock, { once: false, passive: true });
      document.addEventListener('keydown', unlock, { once: false, passive: true });
      this.audioUnlockBound = true;
    }
  }

  /**
   * Listen to events from background (for native chrome.tts)
   */
  initRuntimeListeners() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'TTS_AUDIO_START') {
        this.isPlaying = true;
        if (typeof this.onSpeechStart === 'function') {
          this.onSpeechStart();
        }
      } else if (msg.action === 'TTS_AUDIO_END') {
        if (this.isPlaying) {
          this.isPlaying = false;
          if (typeof this.onSpeechEnd === 'function') {
            this.onSpeechEnd();
          }
        }
      }
    });
  }

  /**
   * Populate Vietnamese voices (Studio Neural voices first, then system voices)
   */
  initVoices() {
    const defaultStudioVoices = [
      {
        name: 'vi-VN-HoaiMyNeural',
        displayName: '🌟 Hoài My (Nữ - Truyền cảm, tự nhiên VTV)',
        lang: 'vi-VN',
        isNeural: true
      },
      {
        name: 'vi-VN-NamMinhNeural',
        displayName: '🌟 Nam Minh (Nam - Trầm ấm, chuyên nghiệp)',
        lang: 'vi-VN',
        isNeural: true
      }
    ];

    const updateVoices = () => {
      const merged = [...defaultStudioVoices];

      // Query native Chrome TTS voices
      try {
        chrome.runtime.sendMessage({ action: 'GET_CHROME_TTS_VOICES' }, (res) => {
          if (res && Array.isArray(res.voices)) {
            res.voices.forEach(cv => {
              const name = cv.voiceName || cv.name;
              if (!merged.some(v => v.name === name)) {
                merged.push({
                  name: name,
                  displayName: cv.displayName || name,
                  lang: cv.lang || 'vi-VN',
                  isNativeChrome: true,
                  isNeural: !!cv.isNeural
                });
              }
            });
          }
          this.voices = merged;
        });
      } catch (_) {
        this.voices = merged;
      }

      // Merge local Web Speech API voices
      if (window.speechSynthesis) {
        const webVoices = window.speechSynthesis.getVoices() || [];
        webVoices
          .filter(v =>
            (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
            (v.name && v.name.toLowerCase().includes('vietnam'))
          )
          .forEach(wv => {
            if (!merged.some(v => v.name === wv.name)) {
              merged.push({
                name: wv.name,
                displayName: `🖥️ ${wv.name} (Trình duyệt)`,
                lang: wv.lang || 'vi-VN',
                rawVoice: wv
              });
            }
          });
      }

      this.voices = merged;
    };

    updateVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  getAvailableVoices() {
    return this.voices;
  }

  getSelectedVoice() {
    if (this.voices.length === 0) return null;
    if (this.options.selectedVoiceName) {
      const match = this.voices.find(v => v.name === this.options.selectedVoiceName);
      if (match) return match;
    }
    return this.voices[0];
  }

  /**
   * Calculate speech rate dynamically to fit cue duration
   */
  calculateRate(text, durationSeconds) {
    if (!this.options.autoRate || !durationSeconds || durationSeconds <= 0) {
      return this.options.rate;
    }

    const wordCount = text.trim().split(/\s+/).length;
    const baseDuration = wordCount / 3.2; // ~3.2 words per second average

    if (baseDuration <= 0) return this.options.rate;

    let targetRate = baseDuration / durationSeconds;
    return Math.min(Math.max(targetRate, 0.85), 1.6);
  }

  /**
   * Master speak entrypoint
   */
  async speak(text, durationSeconds = null) {
    if (!text || !text.trim()) return;

    this.stop(); // Cut off previous speech immediately for zero-lag sync

    const voice = this.getSelectedVoice();
    const rate = this.calculateRate(text, durationSeconds);
    const voiceName = voice?.name || this.options.selectedVoiceName || 'vi-VN-HoaiMyNeural';

    console.log('[VietDub TTS] Speaking:', text, '| Rate:', rate.toFixed(2), '| Voice:', voiceName, '| Engine:', this.options.ttsEngine);

    // Strategy 1: Explicitly requested native Chrome TTS
    if (this.options.ttsEngine === 'chrome-tts') {
      return this.speakNativeChrome(text, rate, voiceName);
    }

    // Strategy 2: Explicitly requested Web Speech
    if (this.options.ttsEngine === 'web-speech' && voice && !voice.isNeural) {
      return this.speakWebSpeech(text, rate, voice.rawVoice || voice);
    }

    // Strategy 3: Studio Neural Stream (Default & Auto Mode & OpenAI)
    // 24kHz HD broadcast audio decoded CSP-safely via Web Audio API
    if (
      !this.options.ttsEngine ||
      this.options.ttsEngine === 'auto' ||
      this.options.ttsEngine === 'edge-neural' ||
      this.options.ttsEngine === 'openai' ||
      !voice ||
      voice.isNeural ||
      voiceName.includes('Neural')
    ) {
      const success = await this.speakWebAudioStream(text, rate, voiceName);
      if (success) return;
    }

    // Strategy 4: Local system voice fallback if available
    if (voice && !voice.isNeural && window.speechSynthesis) {
      const success = await this.speakWebSpeech(text, rate, voice.rawVoice || voice);
      if (success) return;
    }

    // Strategy 5: Universal Fallback Web Audio Stream
    return this.speakWebAudioStream(text, rate, 'vi-VN-HoaiMyNeural');
  }

  /**
   * Strategy: Web Speech API (Local browser synth)
   */
  speakWebSpeech(text, rate, voice) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve(false);

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = 'vi-VN';
      utterance.volume = this.options.volume;
      utterance.rate = rate;
      utterance.pitch = 1.0;

      window._vietDubUtterance = utterance;

      let started = false;
      const startTimer = setTimeout(() => {
        if (!started) {
          console.warn('[VietDub TTS] Web Speech start timeout, falling back');
          resolve(false);
        }
      }, 400);

      utterance.onstart = () => {
        started = true;
        clearTimeout(startTimer);
        this.isPlaying = true;
        if (typeof this.onSpeechStart === 'function') {
          this.onSpeechStart();
        }
      };

      const finish = () => {
        clearTimeout(startTimer);
        if (this.isPlaying) {
          this.isPlaying = false;
          if (typeof this.onSpeechEnd === 'function') {
            this.onSpeechEnd();
          }
        }
        window._vietDubUtterance = null;
        resolve(true);
      };

      utterance.onend = finish;
      utterance.onerror = (e) => {
        console.warn('[VietDub TTS] Web Speech error:', e.error);
        finish();
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[VietDub TTS] Speak call threw:', err);
        clearTimeout(startTimer);
        resolve(false);
      }
    });
  }

  /**
   * Strategy: Native chrome.tts API via Background Service Worker
   */
  speakNativeChrome(text, rate, voiceName) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'SPEAK_CHROME_TTS',
        text: text,
        rate: rate,
        volume: this.options.volume,
        voiceName: voiceName
      }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Strategy: Studio Web Audio API stream decoding 24kHz HD MP3 (Edge Neural / OpenAI)
   * 100% immune to Page CSP, supports exact volume gain & audio ducking
   */
  speakWebAudioStream(text, rate = 1.0, voiceName = null) {
    return new Promise((resolve) => {
      this.initAudioContext();
      if (!this.audioCtx) return resolve(false);

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      const targetVoice = voiceName || this.options.selectedVoiceName || 'vi-VN-HoaiMyNeural';

      chrome.runtime.sendMessage({
        action: 'FETCH_TTS_AUDIO',
        text: text,
        rate: rate,
        voiceName: targetVoice
      }, async (res) => {
        if (chrome.runtime.lastError || !res || !res.success || !res.audioBase64) {
          console.warn('[VietDub TTS] Fetch audio stream failed:', chrome.runtime.lastError?.message || res?.error);
          return resolve(false);
        }

        try {
          // Convert base64 to ArrayBuffer
          const binaryString = atob(res.audioBase64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Decode raw MP3 audio via Web Audio API (CSP-safe)
          const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);

          // Create Audio Buffer Source Node
          const source = this.audioCtx.createBufferSource();
          source.buffer = audioBuffer;

          // If the TTS server already applied the prosody speed rate, keep playbackRate at 1.0
          if (res.serverRateApplied) {
            source.playbackRate.value = 1.0;
          } else {
            source.playbackRate.value = Math.min(Math.max(rate, 0.85), 1.6);
          }

          // Gain Node for Volume Control
          const gainNode = this.audioCtx.createGain();
          gainNode.gain.value = this.options.volume;

          source.connect(gainNode);
          gainNode.connect(this.audioCtx.destination);

          this.currentSourceNode = source;

          source.onended = () => {
            if (this.isPlaying) {
              this.isPlaying = false;
              if (typeof this.onSpeechEnd === 'function') {
                this.onSpeechEnd();
              }
            }
            this.currentSourceNode = null;
            resolve(true);
          };

          this.isPlaying = true;
          if (typeof this.onSpeechStart === 'function') {
            this.onSpeechStart();
          }

          source.start(0);
        } catch (err) {
          console.warn('[VietDub TTS] Web Audio decode/play error:', err);
          if (this.isPlaying) {
            this.isPlaying = false;
            if (typeof this.onSpeechEnd === 'function') {
              this.onSpeechEnd();
            }
          }
          resolve(false);
        }
      });
    });
  }

  pause() {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
    if (this.audioCtx && this.audioCtx.state === 'running') {
      this.audioCtx.suspend().catch(() => {});
    }
  }

  resume() {
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    try {
      chrome.runtime.sendMessage({ action: 'STOP_CHROME_TTS' }, () => {});
    } catch (_) {}

    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch (_) {}
      this.currentSourceNode = null;
    }

    if (this.isPlaying) {
      this.isPlaying = false;
      if (typeof this.onSpeechEnd === 'function') {
        this.onSpeechEnd();
      }
    }
  }

  setOptions(newOpts) {
    Object.assign(this.options, newOpts);
  }
}

// Expose globally
window.VietDubTTSEngine = VietDubTTSEngine;
