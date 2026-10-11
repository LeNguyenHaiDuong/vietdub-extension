/**
 * VietDub - Text-To-Speech (TTS) Orchestration Engine
 * Supports Web Speech API (Built-in vi-VN voices) & Google TTS Direct Audio
 */

class VietDubTTSEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      volume: 1.0,
      duckingRatio: 0.25,
      rate: 1.05,
      autoRate: true,
      selectedVoiceName: '',
      ttsEngine: 'web-speech' // 'web-speech' or 'google-tts'
    }, options);

    this.voices = [];
    this.currentUtterance = null;
    this.fallbackAudio = null;
    this.isPlaying = false;
    this.speechQueue = [];

    // Callbacks for Audio Ducking in content.js
    this.onSpeechStart = null;
    this.onSpeechEnd = null;

    this.initVoices();
  }

  /**
   * Load and sort available Vietnamese voices
   */
  initVoices() {
    const updateVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      // Filter Vietnamese voices
      this.voices = allVoices.filter(v => 
        (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
        (v.name && v.name.toLowerCase().includes('vietnam'))
      );

      // Sort priority: Natural voices (Microsoft HoaiMy/NamMinh) > Google > Other
      this.voices.sort((a, b) => {
        const aNat = a.name.includes('Natural') || a.name.includes('Online');
        const bNat = b.name.includes('Natural') || b.name.includes('Online');
        if (aNat && !bNat) return -1;
        if (!aNat && bNat) return 1;
        const aGoogle = a.name.includes('Google');
        const bGoogle = b.name.includes('Google');
        if (aGoogle && !bGoogle) return -1;
        if (!aGoogle && bGoogle) return 1;
        return 0;
      });
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
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
    // Default to the first (highest priority) Vietnamese voice
    return this.voices[0];
  }

  /**
   * Calculate speech rate to fit subtitle duration
   * @param {string} text 
   * @param {number} durationSeconds (optional)
   */
  calculateRate(text, durationSeconds) {
    if (!this.options.autoRate || !durationSeconds || durationSeconds <= 0) {
      return this.options.rate;
    }

    // Average Vietnamese speech: ~3.2 words per second at 1.0x
    const wordCount = text.trim().split(/\s+/).length;
    const baseDuration = wordCount / 3.2;

    if (baseDuration <= 0) return this.options.rate;

    let targetRate = baseDuration / durationSeconds;
    // Clamp to realistic bounds (0.85x to 1.75x)
    return Math.min(Math.max(targetRate, 0.85), 1.75);
  }

  /**
   * Speak a sentence using Web Speech API or Fallback Audio
   */
  async speak(text, durationSeconds = null) {
    if (!text || !text.trim()) return;

    this.stop(); // Stop previous utterance immediately to prevent lagging speech

    const voice = this.getSelectedVoice();
    const rate = this.calculateRate(text, durationSeconds);

    // If no native Vietnamese voice exists or user explicitly chose google-tts
    if (this.options.ttsEngine === 'google-tts' || !voice) {
      return this.speakWithGoogleTTS(text, rate);
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.volume = this.options.volume;
      utterance.rate = rate;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        this.isPlaying = true;
        if (typeof this.onSpeechStart === 'function') {
          this.onSpeechStart();
        }
      };

      const finish = () => {
        if (this.isPlaying) {
          this.isPlaying = false;
          if (typeof this.onSpeechEnd === 'function') {
            this.onSpeechEnd();
          }
        }
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = (e) => {
        console.warn('[VietDub TTS] Utterance error:', e.error);
        finish();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Fallback: Google Translate audio stream
   */
  speakWithGoogleTTS(text, rate = 1.0) {
    return new Promise((resolve) => {
      if (this.fallbackAudio) {
        this.fallbackAudio.pause();
        this.fallbackAudio = null;
      }

      const encoded = encodeURIComponent(text);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encoded}`;

      const audio = new Audio(url);
      audio.volume = this.options.volume;
      audio.playbackRate = Math.min(Math.max(rate, 0.9), 1.5);

      audio.onplay = () => {
        this.isPlaying = true;
        if (typeof this.onSpeechStart === 'function') {
          this.onSpeechStart();
        }
      };

      const finish = () => {
        if (this.isPlaying) {
          this.isPlaying = false;
          if (typeof this.onSpeechEnd === 'function') {
            this.onSpeechEnd();
          }
        }
        this.fallbackAudio = null;
        resolve();
      };

      audio.onended = finish;
      audio.onerror = (err) => {
        console.warn('[VietDub Google TTS] Audio stream error:', err);
        finish();
      };

      this.fallbackAudio = audio;
      audio.play().catch(finish);
    });
  }

  pause() {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
    if (this.fallbackAudio && !this.fallbackAudio.paused) {
      this.fallbackAudio.pause();
    }
  }

  resume() {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    if (this.fallbackAudio && this.fallbackAudio.paused) {
      this.fallbackAudio.play().catch(() => {});
    }
  }

  stop() {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
    if (this.fallbackAudio) {
      this.fallbackAudio.pause();
      this.fallbackAudio = null;
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
