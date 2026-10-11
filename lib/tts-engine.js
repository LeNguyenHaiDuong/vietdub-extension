/**
 * VietDub - Text-To-Speech (TTS) Orchestration Engine
 * Ultra-Reliable Multi-Engine: Native chrome.tts, Web Audio Stream (CSP-Immune), and Web Speech API
 */

class VietDubTTSEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      volume: 1.0,
      duckingRatio: 0.25,
      rate: 1.05,
      autoRate: true,
      selectedVoiceName: '',
      ttsEngine: 'auto' // 'auto', 'chrome-tts', 'google-stream', 'web-speech'
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
      if (AudioCtxClass) {
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
   * Discover Vietnamese voices from Web Speech API and native Chrome TTS
   */
  initVoices() {
    const updateVoices = () => {
      const webVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      this.voices = webVoices.filter(v =>
        (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
        (v.name && v.name.toLowerCase().includes('vietnam'))
      );

      // Also query native Chrome TTS voices
      try {
        chrome.runtime.sendMessage({ action: 'GET_CHROME_TTS_VOICES' }, (res) => {
          if (res && Array.isArray(res.voices)) {
            const chromeVi = res.voices.filter(v =>
              (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
              (v.voiceName && v.voiceName.toLowerCase().includes('vietnam'))
            );
            // Merge unique voice names
            chromeVi.forEach(cv => {
              if (!this.voices.some(v => (v.name || v.voiceName) === cv.voiceName)) {
                this.voices.push({
                  name: cv.voiceName,
                  lang: cv.lang || 'vi-VN',
                  isNativeChrome: true
                });
              }
            });
          }
        });
      } catch (_) {}

      // Sort priority: Natural voices (Microsoft HoaiMy/NamMinh) > Google > Other
      this.voices.sort((a, b) => {
        const aNat = (a.name || '').includes('Natural') || (a.name || '').includes('Online');
        const bNat = (b.name || '').includes('Natural') || (b.name || '').includes('Online');
        if (aNat && !bNat) return -1;
        if (!aNat && bNat) return 1;
        const aGoogle = (a.name || '').includes('Google');
        const bGoogle = (b.name || '').includes('Google');
        if (aGoogle && !bGoogle) return -1;
        if (!aGoogle && bGoogle) return 1;
        return 0;
      });
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
    return Math.min(Math.max(targetRate, 0.85), 1.75);
  }

  /**
   * Master speak entrypoint
   */
  async speak(text, durationSeconds = null) {
    if (!text || !text.trim()) return;

    this.stop(); // Cut off previous speech immediately for zero-lag sync

    const voice = this.getSelectedVoice();
    const rate = this.calculateRate(text, durationSeconds);

    console.log('[VietDub TTS] Speaking cue:', text, '| Rate:', rate.toFixed(2), '| Voice:', voice?.name || 'Google Stream');

    // Strategy 1: Explicitly requested or selected native Chrome TTS
    if (this.options.ttsEngine === 'chrome-tts') {
      return this.speakNativeChrome(text, rate, voice?.name);
    }

    // Strategy 2: Explicitly requested Google Stream
    if (this.options.ttsEngine === 'google-stream') {
      return this.speakWebAudioStream(text, rate);
    }

    // Strategy 3: Auto Mode
    // If a high-quality local Vietnamese voice exists (e.g. Microsoft HoaiMy or Google tiếng Việt)
    if (voice && !voice.isNativeChrome && window.speechSynthesis) {
      const success = await this.speakWebSpeech(text, rate, voice);
      if (success) return;
    }

    // Strategy 4: If Web Speech is unavailable/failed, try native Chrome TTS API
    const chromeSuccess = await this.speakNativeChrome(text, rate, voice?.name);
    if (chromeSuccess) return;

    // Strategy 5: Universal Fallback - Web Audio API stream (100% works on all OSes & sites)
    return this.speakWebAudioStream(text, rate);
  }

  /**
   * Strategy: Web Speech API (Local browser synth)
   */
  speakWebSpeech(text, rate, voice) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve(false);

      // Cancel any pending hung speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = 'vi-VN';
      utterance.volume = this.options.volume;
      utterance.rate = rate;
      utterance.pitch = 1.0;

      // Prevent Chrome garbage collection bug by pinning to window
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
   * Strategy: Web Audio API decoding base64 stream from Background (100% immune to Page CSP)
   */
  speakWebAudioStream(text, rate = 1.0) {
    return new Promise((resolve) => {
      this.initAudioContext();
      if (!this.audioCtx) return resolve(false);

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      chrome.runtime.sendMessage({
        action: 'FETCH_TTS_AUDIO',
        text: text
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

          // Decode raw audio data via Web Audio API (CSP-Safe!)
          const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);

          // Create Audio Buffer Source Node
          const source = this.audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = Math.min(Math.max(rate, 0.85), 1.6);

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
    // Stop Web Speech
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Stop Native Chrome TTS
    try {
      chrome.runtime.sendMessage({ action: 'STOP_CHROME_TTS' }, () => {});
    } catch (_) {}

    // Stop Web Audio node
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
