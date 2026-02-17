'use strict';

// Tier 1 PII only: financial and identity-theft vectors.
// Operational PII (phones, emails, addresses, IPs) passes through untouched.

const patterns = [
  // SSN: 123-45-6789 or 123 45 6789
  {
    regex: /\b(\d{3})([- ])(\d{2})\2(\d{4})\b/g,
    replacement: '[SSN_REDACTED]',
  },
  // Credit card: 13–19 digit sequences with optional spaces or dashes
  {
    regex: /\b(\d[ -]?){13,19}\b/g,
    replacement: '[CC_REDACTED]',
    validate(match) {
      const digits = match.replace(/[^0-9]/g, '');
      return digits.length >= 13 && digits.length <= 19;
    },
  },
  // Date of birth (context-triggered) — preserves the keyword prefix
  {
    regex: /(\b(?:dob|date\s+of\s+birth|born(?:\s+on)?|birthday)\s*[:\s]\s*)((?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})|(?:(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}))/gi,
    replacer(match, prefix) {
      return prefix + '[DOB_REDACTED]';
    },
  },
  // Bank routing number — requires context keyword (routing, aba, transit)
  // within 30 chars, ABA checksum, first two digits 00–32
  {
    regex: /(\b(?:routing|aba|transit)\b.{0,30}?)\b(\d{9})\b/gi,
    replacer(match, prefix, digits) {
      const firstTwo = parseInt(digits.substring(0, 2), 10);
      if (firstTwo > 32) return match;
      const d = digits.split('').map(Number);
      const checksum =
        (3 * (d[0] + d[3] + d[6]) +
          7 * (d[1] + d[4] + d[7]) +
          (d[2] + d[5] + d[8])) %
        10;
      if (checksum !== 0) return match;
      return prefix + '[ROUTING_REDACTED]';
    },
  },
  // Bank account number — requires context keyword (account, acct, checking, savings)
  // within 30 chars, 6–17 digits
  {
    regex: /(\b(?:account|acct|checking|savings)\b.{0,30}?)\b(\d{6,17})\b/gi,
    replacer(match, prefix) {
      return prefix + '[ACCOUNT_REDACTED]';
    },
  },
  // Passport number — requires "passport" within 30 chars, 6–9 alphanumeric
  // with at least one digit (to avoid matching common English words)
  {
    regex: /(\bpassport\b.{0,30}?)\b((?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,9})\b/gi,
    replacer(match, prefix) {
      return prefix + '[PASSPORT_REDACTED]';
    },
  },
];

/**
 * Scrub PII from a text string. Returns { text, count }.
 */
function scrubText(text) {
  let count = 0;
  let result = text;

  for (const { regex, replacement, validate, replacer } of patterns) {
    // Reset lastIndex since we reuse regex objects across calls
    regex.lastIndex = 0;

    if (replacer) {
      result = result.replace(regex, (...args) => {
        const replaced = replacer(...args);
        if (replaced !== args[0]) count++;
        return replaced;
      });
    } else {
      result = result.replace(regex, (match) => {
        if (validate && !validate(match)) {
          return match;
        }
        count++;
        return replacement;
      });
    }
  }

  return { text: result, count };
}

/**
 * Scrub PII from a messages array (chat completion format).
 * Returns { messages, scrubCount }.
 */
function scrubMessages(messages) {
  if (!Array.isArray(messages)) {
    return { messages: messages, scrubCount: 0 };
  }

  let scrubCount = 0;

  const scrubbed = messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;

    const newMsg = { ...msg };

    if (typeof newMsg.content === 'string') {
      const result = scrubText(newMsg.content);
      newMsg.content = result.text;
      scrubCount += result.count;
    } else if (Array.isArray(newMsg.content)) {
      newMsg.content = newMsg.content.map((item) => {
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          const result = scrubText(item.text);
          scrubCount += result.count;
          return { ...item, text: result.text };
        }
        return item;
      });
    }

    return newMsg;
  });

  return { messages: scrubbed, scrubCount };
}

module.exports = { scrubMessages, scrubText };
