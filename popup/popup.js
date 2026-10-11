/**
 * VietDub - Popup Controller Script
 * Studio Neural Voice Selection, Real-Time Audio Testing & Advanced Engine Settings
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const masterToggle = document.getElementById('masterToggle');
  const statusBanner = document.getElementById('statusBanner');
  const statusText = document.getElementById('statusText');

  // TTS Toggle Elements (Synchronized switch + card)
  const enableTTSToggle = document.getElementById('enableTTSToggle');
  const enableTTSToggleCard = document.getElementById('enableTTSToggleCard');
  const ttsSelectWrapper = document.getElementById('ttsSelectWrapper');
  const ttsSlidersGroup = document.getElementById('ttsSlidersGroup');

  const voiceSelect = document.getElementById('voiceSelect');
  const testVoiceBtn = document.getElementById('testVoiceBtn');
  const voiceQualityBadge = document.getElementById('voiceQualityBadge');

  const dubbingVolume = document.getElementById('dubbingVolume');
  const dubbingVolumeVal = document.getElementById('dubbingVolumeVal');

  const duckingRatio = document.getElementById('duckingRatio');
  const duckingRatioVal = document.getElementById('duckingRatioVal');

  const speechRate = document.getElementById('speechRate');
  const speechRateVal = document.getElementById('speechRateVal');

  const showSubtitlesToggle = document.getElementById('showSubtitlesToggle');
  const autoRateToggle = document.getElementById('autoRateToggle');
  const showOriginalToggle = document.getElementById('showOriginalToggle');
  const meetingModeToggle = document.getElementById('meetingModeToggle');

  const targetLang1Select = document.getElementById('targetLang1Select');
  const targetLang2Select = document.getElementById('targetLang2Select');

  const ttsEngineSelect = document.getElementById('ttsEngineSelect');
  const openaiConfigGroup = document.getElementById('openaiConfigGroup');
  const openaiApiKeyInput = document.getElementById('openaiApiKeyInput');
  const openaiVoiceGroup = document.getElementById('openaiVoiceGroup');
  const openaiVoiceSelect = document.getElementById('openaiVoiceSelect');

  const subtitlePosSelect = document.getElementById('subtitlePosSelect');
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeVal = document.getElementById('fontSizeVal');

  let currentAudioTest = null;
  let isTTSCurrentlyEnabled = true;
  let availableVoices = [
    {
      name: 'vi-VN-HoaiMyNeural',
      displayName: '🌟 Hoài My (Nữ - Truyền cảm, tự nhiên VTV)',
      isNeural: true
    },
    {
      name: 'vi-VN-NamMinhNeural',
      displayName: '🌟 Nam Minh (Nam - Trầm ấm, chuyên nghiệp)',
      isNeural: true
    }
  ];

  // ---------------------------------------------------------------------------
  // 1. Badge & Status Updates
  // ---------------------------------------------------------------------------
  function updateBadge(voiceName, engine) {
    if (!voiceQualityBadge) return;
    if (!isTTSCurrentlyEnabled) {
      voiceQualityBadge.textContent = '🔇 Đã tắt TTS';
      voiceQualityBadge.style.color = '#94a3b8';
      voiceQualityBadge.style.borderColor = 'rgba(148, 163, 184, 0.4)';
      return;
    }

    const vName = (voiceName || '').toLowerCase();
    const eng = (engine || '').toLowerCase();

    if (eng === 'openai') {
      voiceQualityBadge.textContent = '🤖 OpenAI Studio';
      voiceQualityBadge.style.color = '#00ff87';
      voiceQualityBadge.style.borderColor = 'rgba(0, 255, 135, 0.4)';
    } else if (vName.includes('neural') || eng === 'edge-neural' || eng === 'auto') {
      voiceQualityBadge.textContent = '✨ Studio 24kHz';
      voiceQualityBadge.style.color = 'var(--accent-cyan)';
      voiceQualityBadge.style.borderColor = 'rgba(0, 242, 254, 0.4)';
    } else if (eng === 'chrome-tts' || eng === 'web-speech') {
      voiceQualityBadge.textContent = '🖥️ Hệ thống';
      voiceQualityBadge.style.color = '#facc15';
      voiceQualityBadge.style.borderColor = 'rgba(250, 204, 21, 0.4)';
    } else {
      voiceQualityBadge.textContent = '🌐 Chuẩn Web';
      voiceQualityBadge.style.color = '#94a3b8';
      voiceQualityBadge.style.borderColor = 'rgba(148, 163, 184, 0.4)';
    }
  }

  function updateStatusBanner(enabled, ttsEnabled = isTTSCurrentlyEnabled) {
    if (enabled) {
      statusBanner.classList.remove('disabled');
      if (!ttsEnabled) {
        statusText.textContent = 'VietDub đang chạy: Chỉ hiện phụ đề';
      } else {
        statusText.textContent = 'VietDub đang kích hoạt trên video';
      }
    } else {
      statusBanner.classList.add('disabled');
      statusText.textContent = 'VietDub đang tạm tắt';
    }
  }

  // Set TTS Enabled / Disabled UI State
  function setTTSStateUI(enabled) {
    isTTSCurrentlyEnabled = enabled;
    if (enableTTSToggle) enableTTSToggle.checked = enabled;
    if (enableTTSToggleCard) enableTTSToggleCard.checked = enabled;

    if (enabled) {
      if (ttsSelectWrapper) ttsSelectWrapper.classList.remove('muted-dimmed');
      if (ttsSlidersGroup) ttsSlidersGroup.classList.remove('muted-dimmed');
      if (testVoiceBtn) {
        testVoiceBtn.disabled = false;
        testVoiceBtn.title = 'Nghe thử giọng';
      }
    } else {
      if (ttsSelectWrapper) ttsSelectWrapper.classList.add('muted-dimmed');
      if (ttsSlidersGroup) ttsSlidersGroup.classList.add('muted-dimmed');
      if (testVoiceBtn) {
        testVoiceBtn.disabled = true;
        testVoiceBtn.title = 'Bật lồng tiếng TTS để nghe thử';
      }
      if (currentAudioTest) {
        try { currentAudioTest.pause(); currentAudioTest = null; } catch (_) {}
      }
    }

    updateBadge(voiceSelect.value, ttsEngineSelect.value);
    updateStatusBanner(masterToggle.checked, enabled);
  }

  function handleTTSToggleChange(val) {
    setTTSStateUI(val);
    chrome.storage.local.set({ enableTTS: val });
  }

  // ---------------------------------------------------------------------------
  // 2. Populate Available Vietnamese Voices
  // ---------------------------------------------------------------------------
  function renderVoiceDropdown(selectedName = 'vi-VN-HoaiMyNeural') {
    voiceSelect.innerHTML = '';

    availableVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.displayName || v.name;
      if (selectedName && v.name === selectedName) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });

    if (!selectedName && availableVoices.length > 0) {
      voiceSelect.value = availableVoices[0].name;
    }

    updateBadge(voiceSelect.value, ttsEngineSelect.value);
  }

  function populateVoices(selectedName = 'vi-VN-HoaiMyNeural') {
    chrome.runtime.sendMessage({ action: 'GET_CHROME_TTS_VOICES' }, (res) => {
      const list = [
        {
          name: 'vi-VN-HoaiMyNeural',
          displayName: '🌟 Hoài My (Nữ - Truyền cảm, tự nhiên VTV)',
          isNeural: true
        },
        {
          name: 'vi-VN-NamMinhNeural',
          displayName: '🌟 Nam Minh (Nam - Trầm ấm, chuyên nghiệp)',
          isNeural: true
        }
      ];

      if (res && Array.isArray(res.voices)) {
        res.voices.forEach(v => {
          const vName = v.voiceName || v.name;
          if (!list.some(x => x.name === vName)) {
            list.push({
              name: vName,
              displayName: v.displayName || `🖥️ ${vName}`,
              isNeural: !!v.isNeural
            });
          }
        });
      }

      // Also merge Web Speech API voices
      if (window.speechSynthesis) {
        const webVoices = window.speechSynthesis.getVoices() || [];
        webVoices
          .filter(v => (v.lang && v.lang.toLowerCase().startsWith('vi')) || (v.name && v.name.toLowerCase().includes('vietnam')))
          .forEach(wv => {
            if (!list.some(x => x.name === wv.name)) {
              list.push({
                name: wv.name,
                displayName: `🖥️ ${wv.name} (Trình duyệt)`,
                isNeural: false
              });
            }
          });
      }

      availableVoices = list;
      renderVoiceDropdown(selectedName);
    });
  }

  populateVoices();
  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      chrome.storage.local.get(['selectedVoice'], (res) => {
        populateVoices(res.selectedVoice || 'vi-VN-HoaiMyNeural');
      });
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Load & Sync State from Chrome Storage
  // ---------------------------------------------------------------------------
  chrome.storage.local.get([
    'enabled',
    'enableTTS',
    'showSubtitles',
    'dubbingVolume',
    'duckingRatio',
    'speechRate',
    'autoRate',
    'selectedVoice',
    'ttsEngine',
    'openaiApiKey',
    'openaiVoice',
    'subtitlePosition',
    'fontSize',
    'targetLang1',
    'targetLang2',
    'showOriginal',
    'meetingMode'
  ], (res) => {
    // Enabled
    const isEnabled = res.enabled !== false;
    masterToggle.checked = isEnabled;

    // TTS Toggle
    const isTTS = res.enableTTS !== false;
    setTTSStateUI(isTTS);
    updateStatusBanner(isEnabled, isTTS);

    // Toggles
    showSubtitlesToggle.checked = res.showSubtitles !== false;
    autoRateToggle.checked = res.autoRate !== false;
    if (showOriginalToggle) showOriginalToggle.checked = res.showOriginal !== false;
    if (meetingModeToggle) meetingModeToggle.checked = res.meetingMode === true;

    // Language Selects
    if (targetLang1Select) targetLang1Select.value = res.targetLang1 || 'vi';
    if (targetLang2Select) targetLang2Select.value = res.targetLang2 || 'en';

    // Sliders
    const vol = res.dubbingVolume !== undefined ? Math.round(res.dubbingVolume * 100) : 100;
    dubbingVolume.value = vol;
    dubbingVolumeVal.textContent = `${vol}%`;

    const duck = res.duckingRatio !== undefined ? Math.round(res.duckingRatio * 100) : 25;
    duckingRatio.value = duck;
    duckingRatioVal.textContent = `${duck}%`;

    const rate = res.speechRate !== undefined ? Math.round(res.speechRate * 100) : 105;
    speechRate.value = rate;
    speechRateVal.textContent = `${(rate / 100).toFixed(2)}x`;

    // Dropdowns
    const chosenVoice = res.selectedVoice || 'vi-VN-HoaiMyNeural';
    populateVoices(chosenVoice);

    if (res.ttsEngine) {
      ttsEngineSelect.value = res.ttsEngine;
    } else {
      ttsEngineSelect.value = 'auto';
    }

    if (res.openaiApiKey) {
      openaiApiKeyInput.value = res.openaiApiKey;
    }
    if (res.openaiVoice) {
      openaiVoiceSelect.value = res.openaiVoice;
    }

    toggleOpenAIFields(ttsEngineSelect.value);

    if (res.subtitlePosition) {
      subtitlePosSelect.value = res.subtitlePosition;
    }

    const size = res.fontSize || 18;
    fontSizeRange.value = size;
    fontSizeVal.textContent = `${size}px`;
  });

  function toggleOpenAIFields(engine) {
    const isShowing = engine === 'openai';
    if (openaiConfigGroup) {
      openaiConfigGroup.style.display = isShowing ? 'flex' : 'none';
    }
    if (openaiVoiceGroup) {
      openaiVoiceGroup.style.display = isShowing ? 'flex' : 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Event Listeners & Real-Time Persistence
  // ---------------------------------------------------------------------------
  masterToggle.addEventListener('change', () => {
    const val = masterToggle.checked;
    updateStatusBanner(val, isTTSCurrentlyEnabled);
    chrome.storage.local.set({ enabled: val });
  });

  if (enableTTSToggle) {
    enableTTSToggle.addEventListener('change', () => {
      handleTTSToggleChange(enableTTSToggle.checked);
    });
  }

  if (enableTTSToggleCard) {
    enableTTSToggleCard.addEventListener('change', () => {
      handleTTSToggleChange(enableTTSToggleCard.checked);
    });
  }

  showSubtitlesToggle.addEventListener('change', () => {
    chrome.storage.local.set({ showSubtitles: showSubtitlesToggle.checked });
  });

  if (showOriginalToggle) {
    showOriginalToggle.addEventListener('change', () => {
      chrome.storage.local.set({ showOriginal: showOriginalToggle.checked });
    });
  }

  if (meetingModeToggle) {
    meetingModeToggle.addEventListener('change', () => {
      const isMeeting = meetingModeToggle.checked;
      chrome.storage.local.set({ meetingMode: isMeeting });
      if (isMeeting) {
        // Automatically mute TTS when meeting mode is activated
        handleTTSToggleChange(false);
      }
    });
  }

  if (targetLang1Select) {
    targetLang1Select.addEventListener('change', () => {
      chrome.storage.local.set({ targetLang1: targetLang1Select.value });
    });
  }

  if (targetLang2Select) {
    targetLang2Select.addEventListener('change', () => {
      chrome.storage.local.set({ targetLang2: targetLang2Select.value });
    });
  }

  autoRateToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoRate: autoRateToggle.checked });
  });

  dubbingVolume.addEventListener('input', () => {
    const val = parseInt(dubbingVolume.value, 10);
    dubbingVolumeVal.textContent = `${val}%`;
    chrome.storage.local.set({ dubbingVolume: val / 100 });
  });

  duckingRatio.addEventListener('input', () => {
    const val = parseInt(duckingRatio.value, 10);
    duckingRatioVal.textContent = `${val}%`;
    chrome.storage.local.set({ duckingRatio: val / 100 });
  });

  speechRate.addEventListener('input', () => {
    const val = parseInt(speechRate.value, 10);
    speechRateVal.textContent = `${(val / 100).toFixed(2)}x`;
    chrome.storage.local.set({ speechRate: val / 100 });
  });

  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedVoice: voiceSelect.value });
    updateBadge(voiceSelect.value, ttsEngineSelect.value);
  });

  ttsEngineSelect.addEventListener('change', () => {
    const engine = ttsEngineSelect.value;
    chrome.storage.local.set({ ttsEngine: engine });
    toggleOpenAIFields(engine);
    updateBadge(voiceSelect.value, engine);
  });

  openaiApiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ openaiApiKey: openaiApiKeyInput.value.trim() });
  });

  openaiVoiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ openaiVoice: openaiVoiceSelect.value });
  });

  subtitlePosSelect.addEventListener('change', () => {
    chrome.storage.local.set({ subtitlePosition: subtitlePosSelect.value });
  });

  fontSizeRange.addEventListener('input', () => {
    const val = parseInt(fontSizeRange.value, 10);
    fontSizeVal.textContent = `${val}px`;
    chrome.storage.local.set({ fontSize: val });
  });

  // ---------------------------------------------------------------------------
  // 5. Test Voice Button (Plays High-Definition 24kHz Studio Audio)
  // ---------------------------------------------------------------------------
  testVoiceBtn.addEventListener('click', () => {
    if (!isTTSCurrentlyEnabled) return;

    if (currentAudioTest) {
      try {
        currentAudioTest.pause();
        currentAudioTest = null;
      } catch (_) {}
    }

    const sampleText = 'Xin chào! VietDub chúc bạn học tập hiệu quả trên Coursera và LinkedIn.';
    testVoiceBtn.textContent = '🔊 Đang tải...';

    const selectedVoiceName = voiceSelect.value || 'vi-VN-HoaiMyNeural';
    const rate = parseInt(speechRate.value, 10) / 100;
    const vol = parseInt(dubbingVolume.value, 10) / 100;
    const engine = ttsEngineSelect.value;

    const resetBtn = () => {
      testVoiceBtn.textContent = '🔊 Thử giọng';
      currentAudioTest = null;
    };

    // If native chrome.tts or web-speech explicitly chosen with system voice
    if (engine === 'chrome-tts' || (engine === 'web-speech' && !selectedVoiceName.includes('Neural'))) {
      if (engine === 'chrome-tts') {
        chrome.runtime.sendMessage({
          action: 'SPEAK_CHROME_TTS',
          text: sampleText,
          rate: rate,
          volume: vol,
          voiceName: selectedVoiceName
        }, () => {
          setTimeout(resetBtn, 2500);
        });
        return;
      }

      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(sampleText);
        const webVoices = window.speechSynthesis.getVoices();
        const match = webVoices.find(x => x.name === selectedVoiceName);
        if (match) utterance.voice = match;
        utterance.rate = rate;
        utterance.volume = vol;
        utterance.onend = resetBtn;
        utterance.onerror = resetBtn;
        window.speechSynthesis.speak(utterance);
        return;
      }
    }

    // Default & Studio Mode: Fetch 24kHz HD Audio from Edge Neural or OpenAI
    testVoiceBtn.textContent = '🔊 Đang phát...';
    chrome.runtime.sendMessage({
      action: 'FETCH_TTS_AUDIO',
      text: sampleText,
      voiceName: selectedVoiceName,
      rate: rate
    }, (res) => {
      if (res && res.success && res.audioBase64) {
        try {
          const snd = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
          snd.volume = vol;
          if (!res.serverRateApplied) {
            snd.playbackRate = rate;
          }
          snd.onended = resetBtn;
          snd.onerror = resetBtn;
          currentAudioTest = snd;
          snd.play().catch(resetBtn);
        } catch (_) {
          resetBtn();
        }
      } else {
        console.warn('[VietDub Popup] Test voice fetch failed:', res?.error);
        resetBtn();
      }
    });
  });
});
