/**
 * VietDub - Content Script Orchestrator
 * High-Speed 0ms Dual-Phase Subtitles, Pre-fetching, Audio Ducking & TTS Dubbing
 */

(function () {
  // Prevent duplicate injection
  if (window.__vietDubLoaded) return;
  window.__vietDubLoaded = true;

  console.log('[VietDub] Extension content script active on:', window.location.hostname);

  // Core Instances
  const translator = new window.VietDubTranslator();
  const ttsEngine = new window.VietDubTTSEngine();

  // State Management
  let state = {
    enabled: true,
    enableTTS: true,
    showSubtitles: true,
    dubbingVolume: 1.0,
    duckingRatio: 0.25,
    speechRate: 1.05,
    autoRate: true,
    selectedVoice: 'vi-VN-HoaiMyNeural',
    ttsEngine: 'auto',
    subtitlePosition: 'bottom',
    fontSize: 18
  };

  let activeVideo = null;
  let activeTrack = null;
  let domSubtitleObserver = null;
  let lastProcessedText = '';
  let subtitleHideTimeout = null;
  let originalVideoVolume = 1.0;
  let isDucking = false;
  let lastPrefetchTime = 0;

  // UI Elements
  let subtitleOverlay = null;
  let hudChip = null;

  // ---------------------------------------------------------------------------
  // 1. Load Settings & Synchronize
  // ---------------------------------------------------------------------------
  function loadSettings() {
    chrome.storage.local.get(Object.keys(state), (items) => {
      if (items) {
        Object.assign(state, items);
        ttsEngine.setOptions({
          volume: state.dubbingVolume,
          duckingRatio: state.duckingRatio,
          rate: state.speechRate,
          autoRate: state.autoRate,
          selectedVoiceName: state.selectedVoice,
          ttsEngine: state.ttsEngine
        });
        updateOverlayUI();
        updateHudChipUI();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in state) {
        state[key] = change.newValue;
      }
    }

    // If TTS or extension is toggled off, immediately stop speaking and restore original video volume
    if (
      (changes.enableTTS && !changes.enableTTS.newValue) ||
      (changes.enabled && !changes.enabled.newValue)
    ) {
      ttsEngine.stop();
      if (isDucking && activeVideo) {
        activeVideo.volume = originalVideoVolume;
        isDucking = false;
      }
      if (hudChip) {
        const wave = hudChip.querySelector('.vietdub-wave-indicator');
        if (wave) wave.remove();
      }
    }

    ttsEngine.setOptions({
      volume: state.dubbingVolume,
      duckingRatio: state.duckingRatio,
      rate: state.speechRate,
      autoRate: state.autoRate,
      selectedVoiceName: state.selectedVoice,
      ttsEngine: state.ttsEngine
    });

    updateOverlayUI();
    updateHudChipUI();
  });

  // ---------------------------------------------------------------------------
  // 2. Audio Ducking Callbacks
  // ---------------------------------------------------------------------------
  ttsEngine.onSpeechStart = () => {
    if (!activeVideo || !state.enabled || !state.enableTTS) return;

    if (!isDucking) {
      originalVideoVolume = activeVideo.volume;
      isDucking = true;
    }

    // Duck video audio smoothly
    const targetVol = Math.max(0, originalVideoVolume * state.duckingRatio);
    activeVideo.volume = targetVol;

    // Show wave animation on HUD chip
    if (hudChip) {
      let wave = hudChip.querySelector('.vietdub-wave-indicator');
      if (!wave) {
        wave = document.createElement('div');
        wave.className = 'vietdub-wave-indicator';
        wave.innerHTML = '<span></span><span></span><span></span>';
        hudChip.appendChild(wave);
      }
    }
  };

  ttsEngine.onSpeechEnd = () => {
    if (!activeVideo) return;

    // Restore original video volume smoothly
    if (isDucking) {
      activeVideo.volume = originalVideoVolume;
      isDucking = false;
    }

    // Remove wave animation
    if (hudChip) {
      const wave = hudChip.querySelector('.vietdub-wave-indicator');
      if (wave) wave.remove();
    }
  };

  // ---------------------------------------------------------------------------
  // 3. UI Injections (Subtitle Overlay & HUD Chip)
  // ---------------------------------------------------------------------------
  function createUI(videoContainer) {
    if (!videoContainer) return;

    // Subtitle Overlay
    if (!subtitleOverlay || !subtitleOverlay.parentElement) {
      subtitleOverlay = document.createElement('div');
      subtitleOverlay.className = 'vietdub-subtitle-overlay hidden';
      subtitleOverlay.innerHTML = `
        <span class="vietdub-sub-original" id="vietdubSubOrig"></span>
        <span class="vietdub-sub-translated" id="vietdubSubTrans"></span>
      `;
      videoContainer.appendChild(subtitleOverlay);
    }

    // Quick HUD Chip
    if (!hudChip || !hudChip.parentElement) {
      hudChip = document.createElement('div');
      hudChip.className = 'vietdub-hud-chip';
      hudChip.title = 'Bật/Tắt Lồng tiếng & Phụ đề Việt (VietDub)';
      hudChip.innerHTML = `
        <span class="hud-dot"></span>
        <span class="hud-label">VietDub</span>
      `;

      hudChip.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const nextState = !state.enabled;
        chrome.storage.local.set({ enabled: nextState });
      });

      videoContainer.appendChild(hudChip);
    }

    updateOverlayUI();
    updateHudChipUI();
  }

  function updateOverlayUI() {
    if (!subtitleOverlay) return;

    if (state.subtitlePosition === 'top') {
      subtitleOverlay.classList.add('pos-top');
    } else {
      subtitleOverlay.classList.remove('pos-top');
    }

    subtitleOverlay.style.fontSize = `${state.fontSize}px`;

    if (!state.showSubtitles) {
      subtitleOverlay.classList.add('hidden');
    }
  }

  function updateHudChipUI() {
    if (!hudChip) return;
    if (state.enabled) {
      hudChip.classList.remove('disabled');
      hudChip.classList.add('active');
      if (!state.enableTTS) {
        hudChip.querySelector('.hud-label').textContent = 'VietDub: Phụ đề';
        const wave = hudChip.querySelector('.vietdub-wave-indicator');
        if (wave) wave.remove();
      } else {
        hudChip.querySelector('.hud-label').textContent = 'VietDub: BẬT';
      }
    } else {
      hudChip.classList.remove('active');
      hudChip.classList.add('disabled');
      hudChip.querySelector('.hud-label').textContent = 'VietDub: TẮT';
      ttsEngine.stop();
      if (subtitleOverlay) subtitleOverlay.classList.add('hidden');
    }
  }

  function displaySubtitles(original, translated, durationSec) {
    if (!subtitleOverlay || !state.showSubtitles) return;

    const origEl = subtitleOverlay.querySelector('#vietdubSubOrig');
    const transEl = subtitleOverlay.querySelector('#vietdubSubTrans');

    if (origEl) origEl.textContent = original;
    if (transEl) {
      transEl.innerHTML = `<span class="highlight-vi">${translated}</span>`;
    }

    subtitleOverlay.classList.remove('hidden');

    // Auto-hide when duration expires
    if (subtitleHideTimeout) clearTimeout(subtitleHideTimeout);
    const hideDelay = Math.max(3000, (durationSec || 3.5) * 1000);
    subtitleHideTimeout = setTimeout(() => {
      if (subtitleOverlay) subtitleOverlay.classList.add('hidden');
    }, hideDelay);
  }

  // ---------------------------------------------------------------------------
  // 4. Instant Dual-Phase Cue Processing & Pre-fetching
  // ---------------------------------------------------------------------------
  async function processCue(rawText, startTime = null, endTime = null) {
    if (!state.enabled || !rawText) return;

    const sanitized = translator.sanitizeSubtitle(rawText);
    if (!sanitized || sanitized === lastProcessedText) return;
    lastProcessedText = sanitized;

    const duration = (endTime && startTime && endTime > startTime)
      ? Math.max(1.0, endTime - startTime)
      : 3.5;

    // Check synchronous cache first (0ms instantaneous lookup)
    const cachedTranslation = translator.getCached(sanitized);

    if (cachedTranslation) {
      // 0ms Cache Hit: Display and Speak IMMEDIATELY!
      displaySubtitles(sanitized, cachedTranslation, duration);
      if (state.enabled && state.enableTTS && activeVideo && !activeVideo.paused) {
        ttsEngine.speak(cachedTranslation, duration);
      }
    } else {
      // Phase 1 (0ms): Immediately show the English cue so the user sees text with ZERO delay!
      displaySubtitles(sanitized, '⏳ Đang dịch...', duration);

      // Phase 2: Translate in background and update instantly upon resolution
      const translated = await translator.translate(sanitized);
      
      // Update line 2 with translated Vietnamese
      displaySubtitles(sanitized, translated, duration);

      // Speak Vietnamese voice
      if (state.enabled && state.enableTTS && activeVideo && !activeVideo.paused) {
        ttsEngine.speak(translated, duration);
      }
    }
  }

  /**
   * Pre-fetch upcoming cues for the next 60 seconds
   */
  function prefetchCuesAhead(track, currentTime) {
    if (!track || !track.cues || track.cues.length === 0) return;
    const now = Date.now();
    if (now - lastPrefetchTime < 5000) return; // Limit to once every 5 seconds
    lastPrefetchTime = now;

    const upcoming = Array.from(track.cues)
      .filter(c => c.startTime >= currentTime && c.startTime <= currentTime + 60)
      .map(c => c.text);

    if (upcoming.length > 0) {
      translator.prefetchUpcoming(upcoming);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Video Element Hooks & TextTrack Detection
  // ---------------------------------------------------------------------------
  function attachVideoHooks(video) {
    if (!video || video === activeVideo) return;
    activeVideo = video;
    originalVideoVolume = video.volume;

    console.log('[VietDub] Hooked video element:', video);

    // Locate best container to mount HUD and subtitle overlay
    const container = video.parentElement || video;
    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    createUI(container);

    // Unlock Web Audio API & Speech Synthesis on user interaction / video play
    const unlockAudio = () => {
      ttsEngine.initAudioContext();
      if (ttsEngine.audioCtx && ttsEngine.audioCtx.state === 'suspended') {
        ttsEngine.audioCtx.resume().catch(() => {});
      }
    };
    video.addEventListener('play', unlockAudio);
    video.addEventListener('playing', unlockAudio);

    // Video Lifecycle Events
    video.addEventListener('pause', () => {
      ttsEngine.pause();
    });

    video.addEventListener('play', () => {
      ttsEngine.resume();
    });

    video.addEventListener('seeking', () => {
      ttsEngine.stop();
      if (subtitleOverlay) subtitleOverlay.classList.add('hidden');
    });

    video.addEventListener('volumechange', () => {
      if (!isDucking) {
        originalVideoVolume = video.volume;
      }
    });

    // Time update listener: fast 250ms synchronization loop
    video.addEventListener('timeupdate', () => {
      if (!state.enabled) return;

      // Check textTracks for current cue
      if (activeTrack && activeTrack.activeCues && activeTrack.activeCues.length > 0) {
        const cue = activeTrack.activeCues[0];
        if (cue && cue.text) {
          processCue(cue.text, cue.startTime, cue.endTime);
        }
      }

      // Pre-fetch upcoming cues ahead of playback position
      if (activeTrack) {
        prefetchCuesAhead(activeTrack, video.currentTime);
      }
    });

    // Strategy A: HTML5 textTracks API (Coursera, LinkedIn, Udemy, standard players)
    hookTextTracks(video);

    // Strategy B: DOM Mutation Observer for custom rendered subtitles
    hookDOMSubtitles();
  }

  function hookTextTracks(video) {
    if (!video || !video.textTracks) return;

    const inspectTracks = () => {
      const tracks = Array.from(video.textTracks);
      // Prioritize English or active subtitles
      const subTrack = tracks.find(t => t.kind === 'subtitles' || t.kind === 'captions');

      if (subTrack && subTrack !== activeTrack) {
        activeTrack = subTrack;
        console.log('[VietDub] Attached to textTrack:', subTrack.label || subTrack.language);

        // Ensure track is active to receive cuechange events
        if (subTrack.mode === 'disabled') {
          subTrack.mode = 'hidden';
        }

        subTrack.addEventListener('cuechange', () => {
          if (!subTrack.activeCues || subTrack.activeCues.length === 0) return;
          const cue = subTrack.activeCues[0];
          if (cue && cue.text) {
            processCue(cue.text, cue.startTime, cue.endTime);
          }
        });

        // Pre-fetch immediately
        prefetchCuesAhead(subTrack, video.currentTime);
      }
    };

    inspectTracks();
    video.textTracks.addEventListener('change', inspectTracks);
  }

  function hookDOMSubtitles() {
    if (domSubtitleObserver) {
      domSubtitleObserver.disconnect();
    }

    const platform = window.VietDubPlatforms.detectPlatform();
    const adapter = window.VietDubPlatforms.getAdapters()[platform];

    domSubtitleObserver = new MutationObserver(() => {
      if (!state.enabled) return;

      for (const selector of adapter.subtitleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          const text = el.textContent.trim();
          if (text && text !== lastProcessedText) {
            processCue(text);
            break;
          }
        }
      }
    });

    domSubtitleObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Platform Scanner Loop (Single-Page App Navigation Resilient)
  // ---------------------------------------------------------------------------
  function scanForVideo() {
    const video = window.VietDubPlatforms.findVideoElement();
    if (video && video !== activeVideo) {
      attachVideoHooks(video);
    }
  }

  // Scan immediately and poll smoothly for dynamic page changes
  loadSettings();
  scanForVideo();
  setInterval(scanForVideo, 1000);

  // Expose test method for debug in console
  window.__vietDub = {
    state,
    ttsEngine,
    translator,
    testDub: (text = 'Xin chào, đây là tính năng lồng tiếng tiếng Việt trực tiếp của VietDub.') => {
      ttsEngine.speak(text, 3.5);
    }
  };
})();
