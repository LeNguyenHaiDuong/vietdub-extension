/**
 * VietDub - Popup Controller Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const masterToggle = document.getElementById('masterToggle');
  const statusBanner = document.getElementById('statusBanner');
  const statusText = document.getElementById('statusText');

  const voiceSelect = document.getElementById('voiceSelect');
  const testVoiceBtn = document.getElementById('testVoiceBtn');

  const dubbingVolume = document.getElementById('dubbingVolume');
  const dubbingVolumeVal = document.getElementById('dubbingVolumeVal');

  const duckingRatio = document.getElementById('duckingRatio');
  const duckingRatioVal = document.getElementById('duckingRatioVal');

  const speechRate = document.getElementById('speechRate');
  const speechRateVal = document.getElementById('speechRateVal');

  const showSubtitlesToggle = document.getElementById('showSubtitlesToggle');
  const autoRateToggle = document.getElementById('autoRateToggle');

  const ttsEngineSelect = document.getElementById('ttsEngineSelect');
  const subtitlePosSelect = document.getElementById('subtitlePosSelect');
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeVal = document.getElementById('fontSizeVal');

  let availableVoices = [];

  // ---------------------------------------------------------------------------
  // 1. Populate Available Vietnamese Voices
  // ---------------------------------------------------------------------------
  function populateVoices(selectedName = '') {
    const allVoices = window.speechSynthesis.getVoices();
    availableVoices = allVoices.filter(v =>
      (v.lang && v.lang.toLowerCase().startsWith('vi')) ||
      (v.name && v.name.toLowerCase().includes('vietnam'))
    );

    voiceSelect.innerHTML = '';

    if (availableVoices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Giọng mặc định (Google / Hệ thống)';
      voiceSelect.appendChild(opt);
      return;
    }

    availableVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (selectedName && v.name === selectedName) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });

    if (!selectedName && availableVoices.length > 0) {
      voiceSelect.value = availableVoices[0].name;
    }
  }

  populateVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      chrome.storage.local.get(['selectedVoice'], (res) => {
        populateVoices(res.selectedVoice);
      });
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Load & Sync State from Chrome Storage
  // ---------------------------------------------------------------------------
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
    'fontSize'
  ], (res) => {
    // Enabled
    const isEnabled = res.enabled !== false;
    masterToggle.checked = isEnabled;
    updateStatusBanner(isEnabled);

    // Toggles
    showSubtitlesToggle.checked = res.showSubtitles !== false;
    autoRateToggle.checked = res.autoRate !== false;

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
    if (res.selectedVoice) {
      populateVoices(res.selectedVoice);
    }
    if (res.ttsEngine) {
      ttsEngineSelect.value = res.ttsEngine;
    }
    if (res.subtitlePosition) {
      subtitlePosSelect.value = res.subtitlePosition;
    }

    const size = res.fontSize || 18;
    fontSizeRange.value = size;
    fontSizeVal.textContent = `${size}px`;
  });

  function updateStatusBanner(enabled) {
    if (enabled) {
      statusBanner.classList.remove('disabled');
      statusText.textContent = 'VietDub đang kích hoạt trên video';
    } else {
      statusBanner.classList.add('disabled');
      statusText.textContent = 'VietDub đang tạm tắt';
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Event Listeners & Real-Time Persistence
  // ---------------------------------------------------------------------------
  masterToggle.addEventListener('change', () => {
    const val = masterToggle.checked;
    updateStatusBanner(val);
    chrome.storage.local.set({ enabled: val });
  });

  showSubtitlesToggle.addEventListener('change', () => {
    chrome.storage.local.set({ showSubtitles: showSubtitlesToggle.checked });
  });

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
  });

  ttsEngineSelect.addEventListener('change', () => {
    chrome.storage.local.set({ ttsEngine: ttsEngineSelect.value });
  });

  subtitlePosSelect.addEventListener('change', () => {
    chrome.storage.local.set({ subtitlePosition: subtitlePosSelect.value });
  });

  fontSizeRange.addEventListener('input', () => {
    const val = parseInt(fontSizeRange.value, 10);
    fontSizeVal.textContent = `${val}px`;
    chrome.storage.local.set({ fontSize: val });
  });

  // Test Voice Button
  testVoiceBtn.addEventListener('click', () => {
    const sampleText = 'Xin chào! VietDub chúc bạn học tập hiệu quả trên Coursera và LinkedIn.';
    window.speechSynthesis.cancel();

    const selectedVoiceName = voiceSelect.value;
    const voice = availableVoices.find(v => v.name === selectedVoiceName) || availableVoices[0];
    const rate = parseInt(speechRate.value, 10) / 100;
    const vol = parseInt(dubbingVolume.value, 10) / 100;

    const utterance = new SpeechSynthesisUtterance(sampleText);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.volume = vol;
    utterance.pitch = 1.0;

    testVoiceBtn.textContent = '🔊 Đang đọc...';
    utterance.onend = () => {
      testVoiceBtn.textContent = '🔊 Thử giọng';
    };
    utterance.onerror = () => {
      testVoiceBtn.textContent = '🔊 Thử giọng';
    };

    window.speechSynthesis.speak(utterance);
  });
});
