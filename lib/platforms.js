/**
 * VietDub - Platform Detectors & Site Adapters
 * Specialized hooks for Coursera, LinkedIn Learning, Udemy, YouTube & Generic HTML5
 */

const VietDubPlatforms = {
  /**
   * Determine the current site adapter
   */
  detectPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('coursera.org')) return 'coursera';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('udemy.com')) return 'udemy';
    if (host.includes('youtube.com')) return 'youtube';
    return 'generic';
  },

  /**
   * Platform-specific configuration & CSS selectors
   */
  getAdapters() {
    return {
      coursera: {
        name: 'Coursera',
        videoSelectors: [
          '.rc-VideoPlayer video',
          'div[data-testid="video-player"] video',
          '.c-video-player video',
          'video'
        ],
        subtitleSelectors: [
          '.rc-Subtitle',
          'div[data-testid="subtitle-container"]',
          '.c-video-subtitle',
          '.rc-SubtitleText',
          '.rc-TranscriptLine.active',
          '.rc-Paragraph.active'
        ],
        subtitleContainerParent: '.rc-VideoPlayer, .c-video-player, div[data-testid="video-player"]'
      },

      linkedin: {
        name: 'LinkedIn Learning',
        videoSelectors: [
          'video.vjs-tech',
          '.classroom-video-player video',
          '.video-js video',
          'video'
        ],
        subtitleSelectors: [
          '.vjs-text-track-display .vjs-text-track-cue',
          '.vjs-text-track-cue',
          '.litms-transcript-line.litms-transcript-line--active',
          '.litms-transcript-line',
          '.mejs__captions-layer',
          '.caption-text'
        ],
        subtitleContainerParent: '.classroom-video-player, .video-js, .mejs__container, .course-player-container'
      },

      udemy: {
        name: 'Udemy',
        videoSelectors: [
          'div[data-purpose="video-player"] video',
          '.video-player-wrapper video',
          'video'
        ],
        subtitleSelectors: [
          '.vjs-text-track-cue',
          'span[data-purpose="cue-text"]',
          'div[data-purpose="transcript-cue-active"]',
          '.transcript-cue--active'
        ],
        subtitleContainerParent: 'div[data-purpose="video-player"], .video-player-wrapper, .video-viewer--container'
      },

      youtube: {
        name: 'YouTube',
        videoSelectors: [
          '#movie_player video',
          'video.html5-main-video',
          'video'
        ],
        subtitleSelectors: [
          '.ytp-caption-segment',
          '.caption-window',
          '.ytp-caption-window-bottom'
        ],
        subtitleContainerParent: '#movie_player, .html5-video-player'
      },

      generic: {
        name: 'Generic Video',
        videoSelectors: ['video'],
        subtitleSelectors: [
          '.vjs-text-track-cue',
          '.caption-cue',
          '[aria-label="captions"]',
          '.subtitle-text',
          '.subtitles-cue'
        ],
        subtitleContainerParent: null
      }
    };
  },

  /**
   * Find the active, visible video element for current platform
   */
  findVideoElement() {
    const platform = this.detectPlatform();
    const adapter = this.getAdapters()[platform];

    // Priority 1: Match site-specific selectors for visible videos
    for (const sel of adapter.videoSelectors) {
      if (sel === 'video') continue; // Test specific selectors first
      const el = document.querySelector(sel);
      if (el && (el.tagName === 'VIDEO' || el instanceof HTMLVideoElement) && el.isConnected) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          return el;
        }
      }
    }

    // Priority 2: All connected <video> tags on the page
    const videos = Array.from(document.querySelectorAll('video')).filter(v => v.isConnected);
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

    // Priority 3: Pick the most active / largest video element
    let best = videos[0];
    let maxScore = -1;

    videos.forEach(v => {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      const isVisible = rect.width > 50 && rect.height > 50 && rect.bottom > 0 && rect.right > 0;

      let score = area;
      if (!v.paused) score += 2000000;
      if (isVisible) score += 1000000;
      if (v.currentTime > 0) score += 500000;
      if (v.readyState >= 1) score += 200000;

      if (score > maxScore) {
        maxScore = score;
        best = v;
      }
    });

    return best || videos[0];
  }
};

window.VietDubPlatforms = VietDubPlatforms;
