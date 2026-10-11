/**
 * VietDub - Client Translation Helper & Subtitle Sanitizer with Fast Cache & Pre-fetching
 */

class VietDubTranslator {
  constructor() {
    this.cache = new Map();
    this.inFlightRequests = new Map();
  }

  /**
   * Remove subtitle tags and non-speech markers like [Music], (Laughter), etc.
   */
  sanitizeSubtitle(rawText) {
    if (!rawText) return '';
    return rawText
      // Remove HTML tags <...>
      .replace(/<[^>]+>/g, '')
      // Remove WebVTT voice/timestamp tags
      .replace(/<v[^>]*>/g, '')
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
      // Remove sound effect brackets like [Music], [Applause], (laughter)
      .replace(/\[(?:Music|Applause|Laughter|Cheering|Silence|Whispering|Chuckle|Sigh|Gasp|Sound)[^\]]*\]/gi, '')
      .replace(/\((?:Music|Applause|Laughter|Cheering|Silence|Whispering|Chuckle|Sigh|Gasp|Sound)[^\)]*\)/gi, '')
      // Remove multiple spaces/newlines
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Alias for sanitizeSubtitle for backwards and cross-module compatibility
   */
  sanitizeCue(rawText) {
    return this.sanitizeSubtitle(rawText);
  }

  /**
   * Parse potential speaker name from live meeting captions (Teams, Meet)
   */
  parseSpeakerAndText(rawText) {
    if (!rawText) return { speaker: '', text: '' };
    const sanitized = this.sanitizeSubtitle(rawText);
    
    // Match "Speaker Name: Speech text"
    const matchColon = sanitized.match(/^([^:\n]{2,35}):\s+(.+)$/);
    if (matchColon) {
      return { speaker: matchColon[1].trim(), text: matchColon[2].trim() };
    }
    
    // Match "[Speaker Name] Speech text"
    const matchBracket = sanitized.match(/^\[([^\]\n]{2,35})\]\s*(.+)$/);
    if (matchBracket) {
      return { speaker: matchBracket[1].trim(), text: matchBracket[2].trim() };
    }

    return { speaker: '', text: sanitized };
  }

  /**
   * Synchronous cache lookup for multi-language translation
   */
  getCachedMulti(text, targetLang1 = 'vi', targetLang2 = 'none') {
    const sanitized = this.sanitizeSubtitle(text);
    if (!sanitized) return null;
    const cacheKey = `${targetLang1}:${targetLang2}:${sanitized}`;
    return this.cache.get(cacheKey) || null;
  }

  /**
   * Synchronous cache lookup (0ms instantaneous return)
   */
  getCached(text, targetLang = 'vi') {
    const res = this.getCachedMulti(text, targetLang, 'none');
    return res ? res.trans1 : null;
  }

  /**
   * Translate text into up to 2 target languages simultaneously
   */
  async translateMulti(text, targetLang1 = 'vi', targetLang2 = 'none') {
    const sanitized = this.sanitizeSubtitle(text);
    if (!sanitized) return { trans1: '', trans2: '' };

    const cacheKey = `${targetLang1}:${targetLang2}:${sanitized}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    if (this.inFlightRequests.has(cacheKey)) {
      return this.inFlightRequests.get(cacheKey);
    }

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'TRANSLATE_MULTI',
          text: sanitized,
          targetLang1: targetLang1,
          targetLang2: targetLang2
        },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            console.warn('[VietDub] Multi-translation warning:', chrome.runtime.lastError?.message || response?.error);
            resolve({ trans1: sanitized, trans2: '' });
          } else {
            const result = {
              trans1: response.trans1 || sanitized,
              trans2: response.trans2 || ''
            };
            this.cache.set(cacheKey, result);
            resolve(result);
          }
          this.inFlightRequests.delete(cacheKey);
        }
      );
    });

    this.inFlightRequests.set(cacheKey, promise);
    return promise;
  }

  /**
   * Translate text to single target language with caching & request deduplication
   */
  async translate(text, targetLang = 'vi') {
    const res = await this.translateMulti(text, targetLang, 'none');
    return res.trans1;
  }

  /**
   * Pre-fetch an array of upcoming subtitle lines ahead of time
   */
  prefetchUpcoming(texts, targetLang1 = 'vi', targetLang2 = 'none') {
    if (!Array.isArray(texts) || texts.length === 0) return;

    for (const t of texts) {
      const sanitized = this.sanitizeSubtitle(t);
      const cacheKey = `${targetLang1}:${targetLang2}:${sanitized}`;
      if (sanitized && !this.cache.has(cacheKey) && !this.inFlightRequests.has(cacheKey)) {
        this.translateMulti(sanitized, targetLang1, targetLang2);
      }
    }
  }

  clearCache() {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

// Expose globally to content scripts
window.VietDubTranslator = VietDubTranslator;
