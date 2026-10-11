/**
 * VietDub - Client Translation Helper & Subtitle Sanitizer
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
      // Remove WebVTT voice tags like <v Speaker>
      .replace(/<v[^>]*>/g, '')
      // Remove sound effect brackets like [Music], [Applause], (laughter)
      .replace(/\[(?:Music|Applause|Laughter|Cheering|Silence|Whispering|Chuckle|Sigh|Gasp)[^\]]*\]/gi, '')
      .replace(/\((?:Music|Applause|Laughter|Cheering|Silence|Whispering|Chuckle|Sigh|Gasp)[^\)]*\)/gi, '')
      // Remove multiple spaces/newlines
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Translate text to Vietnamese with caching & request deduplication
   */
  async translate(text) {
    const sanitized = this.sanitizeSubtitle(text);
    if (!sanitized) return '';

    // Check memory cache
    if (this.cache.has(sanitized)) {
      return this.cache.get(sanitized);
    }

    // Deduplicate in-flight requests for the exact same sentence
    if (this.inFlightRequests.has(sanitized)) {
      return this.inFlightRequests.get(sanitized);
    }

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'TRANSLATE_TEXT', text: sanitized },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            console.warn('[VietDub] Translation warning:', chrome.runtime.lastError?.message || response?.error);
            resolve(sanitized); // Fallback to original
          } else {
            const translation = response.translation || sanitized;
            this.cache.set(sanitized, translation);
            resolve(translation);
          }
          this.inFlightRequests.delete(sanitized);
        }
      );
    });

    this.inFlightRequests.set(sanitized, promise);
    return promise;
  }

  clearCache() {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

// Expose globally to content scripts
window.VietDubTranslator = VietDubTranslator;
