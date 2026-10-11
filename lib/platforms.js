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
          'video',
          '.rc-VideoPlayer video',
          'div[data-testid="video-player"] video'
        ],
        subtitleSelectors: [
          '.rc-Subtitle',
          'div[data-testid="subtitle-container"]',
          '.c-video-subtitle',
          '.rc-SubtitleText'
        ],
        subtitleContainerParent: '.rc-VideoPlayer, .c-video-player, .video-player-container'
      },

      linkedin: {
        name: 'LinkedIn Learning',
        videoSelectors: [
          'video.vjs-tech',
          'video',
          '.video-js video'
        ],
        subtitleSelectors: [
          '.vjs-text-track-display .vjs-text-track-cue',
          '.litms-transcript-line',
          '.mejs__captions-layer',
          '.caption-text'
        ],
        subtitleContainerParent: '.video-js, .mejs__container, .classroom-video-player'
      },

      udemy: {
        name: 'Udemy',
        videoSelectors: [
          'div[data-purpose="video-player"] video',
          'video'
        ],
        subtitleSelectors: [
          '.vjs-text-track-cue',
          'span[data-purpose="cue-text"]'
        ],
        subtitleContainerParent: 'div[data-purpose="video-player"], .video-player-wrapper'
      },

      youtube: {
        name: 'YouTube',
        videoSelectors: [
          'video.html5-main-video',
          'video'
        ],
        subtitleSelectors: [
          '.ytp-caption-segment',
          '.caption-window'
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
          '.subtitle-text'
        ],
        subtitleContainerParent: null
      }
    };
  },

  /**
   * Find the active video element for current platform
   */
  findVideoElement() {
    const platform = this.detectPlatform();
    const adapter = this.getAdapters()[platform];

    for (const sel of adapter.videoSelectors) {
      const el = document.querySelector(sel);
      if (el && el instanceof HTMLVideoElement && el.duration > 0) {
        return el;
      }
    }

    // Fallback: search all videos on page, choose the largest visible one
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

    // Pick largest playing or visible video
    let best = videos[0];
    let maxArea = 0;
    videos.forEach(v => {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea && !v.paused) {
        maxArea = area;
        best = v;
      }
    });
    return best;
  }
};

window.VietDubPlatforms = VietDubPlatforms;
