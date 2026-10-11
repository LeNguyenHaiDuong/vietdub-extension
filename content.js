/**
 * VietDub - Content Script Orchestrator
 * High-Speed 0ms Dual-Phase Subtitles, Pre-fetching, Audio Ducking & TTS Dubbing
 * Resilient Single-Page Application (SPA) auto-advance & video transition detection
 */

(function () {
  // Prevent duplicate injection
  if (window.__vietDubLoaded) return;
  window.__vietDubLoaded = true;

  console.log('[VietDub] Extension content script active on:', window.location.hostname);

  // Core Instances
  const translator = new window.VietDubTranslator();
  const ttsEngine = new window.VietDubTTSEngine();

  // Helper to extract canonical video/lecture identifier (immune to timestamp/hash changes)
  function getVideoIdentifier(urlStr = window.location.href) {
    try {
      const url = new URL(urlStr);
      // YouTube: Video ID parameter
      if (url.hostname.includes('youtube.com')) {
        const v = url.searchParams.get('v');
        if (v) return `yt:${v}`;
        if (url.pathname.startsWith('/shorts/')) {
          return `yt-shorts:${url.pathname.split('/')[2] || url.pathname}`;
        }
      }
      // Educational & generic platforms (Coursera, Udemy, LinkedIn): Pathname represents the lecture
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return (urlStr || '').split('?')[0].split('#')[0];
    }
  }

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
  let lastVideoSrc = '';
  let lastVideoIdentifier = getVideoIdentifier();
  let lastProcessedText = '';
  let subtitleHideTimeout = null;
  let originalVideoVolume = 1.0;
  let isDucking = false;
  let lastPrefetchTime = 0;
  let domSubtitleObserver = null;
  let trackObserver = null;
  let rapidScanTimer = null;

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

        if (state.enabled) {
          scanForVideo();
        }
      }
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key in state) {
        state[key] = change.newValue;
      }
    }

    // Master enabled toggle change
    if (changes.enabled) {
      if (changes.enabled.newValue) {
        console.log('[VietDub] Extension activated via settings');
        scanForVideo();
        if (activeVideo) {
          inspectTracks();
        }
      } else {
        console.log('[VietDub] Extension deactivated via settings');
        ttsEngine.stop();
        if (isDucking && activeVideo) {
          activeVideo.volume = originalVideoVolume;
          isDucking = false;
        }
        if (subtitleOverlay) {
          subtitleOverlay.classList.add('hidden');
        }
        if (hudChip) {
          const wave = hudChip.querySelector('.vietdub-wave-indicator');
          if (wave) wave.remove();
        }
      }
    }

    // TTS toggle change
    if (changes.enableTTS && !changes.enableTTS.newValue) {
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
  function findVideoContainer(video) {
    if (!video) return null;
    const platform = window.VietDubPlatforms.detectPlatform();
    const adapter = window.VietDubPlatforms.getAdapters()[platform];
    let container = null;

    if (adapter && adapter.subtitleContainerParent) {
      container = video.closest(adapter.subtitleContainerParent);
    }
    if (!container) {
      container = video.parentElement || video;
    }

    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    return container;
  }

  function createUI(videoContainer) {
    if (!videoContainer) return;

    // Subtitle Overlay: Check if missing or detached from current container
    if (!subtitleOverlay || !subtitleOverlay.isConnected || subtitleOverlay.parentElement !== videoContainer) {
      if (subtitleOverlay && subtitleOverlay.parentElement) {
        subtitleOverlay.remove();
      }
      subtitleOverlay = document.createElement('div');
      subtitleOverlay.className = 'vietdub-subtitle-overlay hidden';
      subtitleOverlay.innerHTML = `
        <span class="vietdub-sub-original" id="vietdubSubOrig"></span>
        <span class="vietdub-sub-translated" id="vietdubSubTrans"></span>
      `;
      videoContainer.appendChild(subtitleOverlay);
    }

    // Quick HUD Chip: Check if missing or detached from current container
    if (!hudChip || !hudChip.isConnected || hudChip.parentElement !== videoContainer) {
      if (hudChip && hudChip.parentElement) {
        hudChip.remove();
      }
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

    if (!state.showSubtitles || !state.enabled) {
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
    if (!subtitleOverlay || !state.showSubtitles || !state.enabled) return;

    // Safety check: Ensure overlay is still attached to live DOM
    if (!subtitleOverlay.isConnected && activeVideo) {
      const container = findVideoContainer(activeVideo);
      createUI(container);
    }

    const origEl = subtitleOverlay.querySelector('#vietdubSubOrig');
    const transEl = subtitleOverlay.querySelector('#vietdubSubTrans');

    if (origEl) origEl.textContent = original;
    if (transEl) {
      transEl.innerHTML = `<span class="highlight-vi">${translated}</span>`;
    }

    subtitleOverlay.classList.remove('hidden');

    if (subtitleHideTimeout) {
      clearTimeout(subtitleHideTimeout);
    }

    // Auto hide overlay after duration + 1.2s padding
    const hideDelay = Math.max((durationSec || 3.5) * 1000 + 1200, 2500);
    subtitleHideTimeout = setTimeout(() => {
      if (subtitleOverlay) {
        subtitleOverlay.classList.add('hidden');
      }
    }, hideDelay);
  }

  // ---------------------------------------------------------------------------
  // 4. Cue Processing & Immediate Dual-Phase Pipeline
  // ---------------------------------------------------------------------------
  async function processCue(rawText, startTime = null, endTime = null) {
    if (!rawText || !state.enabled) return;

    const sanitizeFn = translator.sanitizeSubtitle || translator.sanitizeCue;
    const sanitized = sanitizeFn.call(translator, rawText);
    if (!sanitized) return;

    // Dedup identical consecutive cues
    if (sanitized === lastProcessedText) return;
    lastProcessedText = sanitized;

    const duration = (endTime !== null && startTime !== null && endTime > startTime)
      ? (endTime - startTime)
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
      // Phase 1 (0ms): Immediately show the original cue so the user sees text with ZERO delay!
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
  // 5. Resilient TextTrack Hooks & Selection
  // ---------------------------------------------------------------------------
  function findBestTextTrack(tracks) {
    if (!tracks || tracks.length === 0) return null;
    const arr = Array.from(tracks);

    // Priority 1: A track actively set to 'showing' or 'hidden'
    const active = arr.find(t => (t.kind === 'subtitles' || t.kind === 'captions') && (t.mode === 'showing' || t.mode === 'hidden'));
    if (active) return active;

    // Priority 2: English subtitles or captions track
    const enTrack = arr.find(t =>
      (t.kind === 'subtitles' || t.kind === 'captions') &&
      ((t.language && t.language.toLowerCase().startsWith('en')) ||
       (t.label && t.label.toLowerCase().includes('en')))
    );
    if (enTrack) return enTrack;

    // Priority 3: Any subtitles or captions track with cues
    const withCues = arr.find(t => (t.kind === 'subtitles' || t.kind === 'captions') && t.cues && t.cues.length > 0);
    if (withCues) return withCues;

    // Priority 4: Any subtitles or captions track
    const anySub = arr.find(t => t.kind === 'subtitles' || t.kind === 'captions');
    if (anySub) return anySub;

    // Priority 5: Fallback to any track with cues
    return arr.find(t => t.cues && t.cues.length > 0) || arr[0];
  }

  function inspectTracks() {
    if (!activeVideo || !activeVideo.textTracks) return;

    const bestTrack = findBestTextTrack(activeVideo.textTracks);
    if (!bestTrack) return;

    if (bestTrack !== activeTrack) {
      activeTrack = bestTrack;
      console.log('[VietDub] Successfully attached to textTrack:', bestTrack.label || bestTrack.language || bestTrack.kind);

      // Must set mode to 'hidden' (or 'showing') so browser parses and emits cues
      if (bestTrack.mode === 'disabled') {
        bestTrack.mode = 'hidden';
      }

      bestTrack.oncuechange = () => {
        if (!bestTrack.activeCues || bestTrack.activeCues.length === 0) return;
        const cue = bestTrack.activeCues[0];
        if (cue && cue.text) {
          processCue(cue.text, cue.startTime, cue.endTime);
        }
      };

      if (activeVideo.currentTime !== undefined) {
        prefetchCuesAhead(bestTrack, activeVideo.currentTime);
      }
    }
  }

  function hookTextTracks(video) {
    if (!video || !video.textTracks) return;

    inspectTracks();

    // Listen to track list mutation events
    video.textTracks.addEventListener('addtrack', inspectTracks);
    video.textTracks.addEventListener('change', inspectTracks);
    video.textTracks.addEventListener('removetrack', inspectTracks);
    video.textTracks.onaddtrack = inspectTracks;
    video.textTracks.onchange = inspectTracks;

    // Observe DOM <track> element insertions inside <video>
    if (trackObserver) {
      trackObserver.disconnect();
    }
    trackObserver = new MutationObserver(inspectTracks);
    trackObserver.observe(video, { childList: true });
  }

  // ---------------------------------------------------------------------------
  // 6. DOM Subtitle Observer (For YouTube, Custom Video.js, Coursera Transcript)
  // ---------------------------------------------------------------------------
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
  // 7. Video Transition & SPA Navigation Handler
  // ---------------------------------------------------------------------------
  function startRapidTrackScan() {
    if (rapidScanTimer) clearInterval(rapidScanTimer);
    let attempts = 0;
    rapidScanTimer = setInterval(() => {
      attempts++;
      if (activeVideo) {
        inspectTracks();
        if (activeTrack && activeTrack.cues && activeTrack.cues.length > 0) {
          console.log('[VietDub] Rapid scan: TextTrack cues loaded and ready!');
          clearInterval(rapidScanTimer);
          rapidScanTimer = null;
          return;
        }
      }
      if (attempts >= 15) { // 15 attempts * 250ms = 3.75 seconds
        clearInterval(rapidScanTimer);
        rapidScanTimer = null;
      }
    }, 250);
  }

  function handleVideoTransition(reason) {
    console.log('[VietDub] Video transition triggered:', reason);

    // 1. Immediately cut off any ongoing speech from the previous video
    ttsEngine.stop();
    if (isDucking && activeVideo) {
      activeVideo.volume = originalVideoVolume;
      isDucking = false;
    }

    // 2. Reset cue and track state
    lastProcessedText = '';
    activeTrack = null;
    lastPrefetchTime = 0;

    // 3. Clear and hide subtitle overlay until new video's subtitles arrive
    if (subtitleOverlay) {
      subtitleOverlay.classList.add('hidden');
      const origEl = subtitleOverlay.querySelector('#vietdubSubOrig');
      const transEl = subtitleOverlay.querySelector('#vietdubSubTrans');
      if (origEl) origEl.textContent = '';
      if (transEl) transEl.innerHTML = '';
    }

    // 4. Re-mount UI in container of active video
    if (activeVideo) {
      const container = findVideoContainer(activeVideo);
      createUI(container);
      hookTextTracks(activeVideo);
    }

    // 5. Start rapid scan to hook subtitles as soon as WebVTT loads asynchronously
    startRapidTrackScan();
  }

  function setupNavigationObserver() {
    const checkNavigation = (source) => {
      const currentId = getVideoIdentifier();
      if (currentId && currentId !== lastVideoIdentifier) {
        console.log(`[VietDub] SPA lecture transition detected via ${source}:`, lastVideoIdentifier, '->', currentId);
        lastVideoIdentifier = currentId;
        handleVideoTransition(`SPA_${source}`);
        setTimeout(scanForVideo, 250);
      }
    };

    // Monkey-patch History API for seamless SPA lecture changes
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      const ret = origPushState.apply(this, args);
      checkNavigation('PUSHSTATE');
      return ret;
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const ret = origReplaceState.apply(this, args);
      checkNavigation('REPLACESTATE');
      return ret;
    };

    window.addEventListener('popstate', () => checkNavigation('POPSTATE'));
    window.addEventListener('hashchange', () => checkNavigation('HASHCHANGE'));
    window.addEventListener('yt-navigate-finish', () => checkNavigation('YT_NAVIGATE'));
  }

  // ---------------------------------------------------------------------------
  // 8. Video Element Hooks & Master Lifecycle
  // ---------------------------------------------------------------------------
  function attachVideoHooks(video) {
    if (!video) return;

    activeVideo = video;
    const currentSrc = video.currentSrc || video.src || '';
    if (currentSrc) {
      lastVideoSrc = currentSrc;
    }
    originalVideoVolume = video.volume;

    // Ensure UI is injected into active container
    const container = findVideoContainer(video);
    createUI(container);

    // If this video element was already hooked with event listeners, just return
    if (video._vietDubHooked) {
      return;
    }
    video._vietDubHooked = true;

    console.log('[VietDub] Hooking video element lifecycle:', video);

    // Unlock Web Audio API & Speech Synthesis on user interaction / video play
    const unlockAudio = () => {
      ttsEngine.initAudioContext();
      if (ttsEngine.audioCtx && ttsEngine.audioCtx.state === 'suspended') {
        ttsEngine.audioCtx.resume().catch(() => {});
      }
    };
    video.addEventListener('play', unlockAudio);
    video.addEventListener('playing', unlockAudio);

    // Metadata loaded: inspect text tracks (do NOT call handleVideoTransition)
    video.addEventListener('loadedmetadata', () => {
      inspectTracks();
    });

    video.addEventListener('play', () => {
      ttsEngine.resume();
      inspectTracks();
    });

    video.addEventListener('pause', () => {
      ttsEngine.pause();
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

    // Time update listener: fast synchronization loop
    video.addEventListener('timeupdate', () => {
      if (!state.enabled) return;

      // Check textTracks for current cue
      if (activeTrack && activeTrack.activeCues && activeTrack.activeCues.length > 0) {
        const cue = activeTrack.activeCues[0];
        if (cue && cue.text) {
          processCue(cue.text, cue.startTime, cue.endTime);
        }
      } else if (!activeTrack || !activeTrack.cues || activeTrack.cues.length === 0) {
        // Asynchronously loaded tracks: retry inspect
        inspectTracks();
      }

      // Pre-fetch upcoming cues ahead of playback position
      if (activeTrack) {
        prefetchCuesAhead(activeTrack, video.currentTime);
      }
    });

    // Hook HTML5 textTracks API
    hookTextTracks(video);

    // Hook DOM Mutation Observer for custom rendered subtitles
    hookDOMSubtitles();
  }

  // ---------------------------------------------------------------------------
  // 9. Platform Scanner Loop (Continuous Health Check & SPA Navigation Poller)
  // ---------------------------------------------------------------------------
  function scanForVideo() {
    // 1. Check if video/lecture changed in SPA
    const currentId = getVideoIdentifier();
    if (currentId && currentId !== lastVideoIdentifier) {
      console.log('[VietDub] Poller detected lecture change:', lastVideoIdentifier, '->', currentId);
      lastVideoIdentifier = currentId;
      handleVideoTransition('POLL_ID_CHANGE');
    }

    // 2. Discover active video element
    const video = window.VietDubPlatforms.findVideoElement();
    if (!video) return;

    const currentSrc = video.currentSrc || video.src || '';

    // If active video element changed entirely
    if (video !== activeVideo) {
      attachVideoHooks(video);
      return;
    }

    // If video source changed on same element (only if lastVideoSrc was already set!)
    if (lastVideoSrc && currentSrc && currentSrc !== lastVideoSrc) {
      lastVideoSrc = currentSrc;
      handleVideoTransition('SRC_CHANGE');
      return;
    } else if (currentSrc && !lastVideoSrc) {
      lastVideoSrc = currentSrc;
    }

    // 3. Ensure UI is still attached to the live document
    if (activeVideo && activeVideo.isConnected) {
      const container = findVideoContainer(activeVideo);
      if (container) {
        if (!subtitleOverlay || !subtitleOverlay.isConnected || !hudChip || !hudChip.isConnected) {
          createUI(container);
        }
      }

      // 4. If activeTrack has not attached yet, retry
      if (!activeTrack || !activeTrack.cues || activeTrack.cues.length === 0) {
        inspectTracks();
      }
    }
  }

  // Initialize
  loadSettings();
  setupNavigationObserver();
  scanForVideo();
  setInterval(scanForVideo, 600); // Smooth 600ms health check

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
