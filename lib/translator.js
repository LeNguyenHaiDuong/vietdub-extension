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
   * Synchronous cache lookup (0ms instantaneous return)
   */
  getCached(text) {
    const sanitized = this.sanitizeSubtitle(text);
    if (!sanitized) return '';
    return this.cache.get(sanitized) || null;
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

  /**
   * Pre-fetch an array of upcoming subtitle lines ahead of time
   */
  prefetchUpcoming(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return;

    const uncached = [];
    for (const t of texts) {
      const sanitized = this.sanitizeSubtitle(t);
      if (sanitized && !this.cache.has(sanitized) && !this.inFlightRequests.has(sanitized)) {
        uncached.push(sanitized);
        // Start individual translate call so cache is populated
        this.translate(sanitized);
      }
    }

    if (uncached.length > 0) {
      chrome.runtime.sendMessage({
        action: 'PREFETCH_TRANSLATIONS',
        texts: uncached
      }, () => {
        // Optional callback
      });
    }
  }

  clearCache() {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

// Expose globally to content scripts
window.VietDubTranslator = VietDubTranslator;
