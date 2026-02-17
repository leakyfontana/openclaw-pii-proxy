'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scrubMessages } = require('./scrubber');

describe('scrubMessages', () => {
  // ── SSN (kept) ──────────────────────────────────────────────

  it('scrubs SSNs', () => {
    const messages = [
      { role: 'user', content: 'My SSN is 123-45-6789' },
      { role: 'user', content: 'Also 123 45 6789' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'My SSN is [SSN_REDACTED]');
    assert.equal(result[1].content, 'Also [SSN_REDACTED]');
    assert.equal(scrubCount, 2);
  });

  // ── Credit card (kept) ─────────────────────────────────────

  it('scrubs credit card numbers', () => {
    const messages = [
      { role: 'user', content: 'Card: 4111 1111 1111 1111' },
      { role: 'user', content: 'Card: 4111-1111-1111-1111' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Card: [CC_REDACTED]');
    assert.equal(result[1].content, 'Card: [CC_REDACTED]');
    assert.equal(scrubCount, 2);
  });

  // ── Bank routing number (new) ──────────────────────────────

  it('scrubs routing number with context keyword', () => {
    const messages = [
      { role: 'user', content: 'my routing number is 021000021' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'my routing number is [ROUTING_REDACTED]');
    assert.equal(scrubCount, 1);
  });

  it('does not scrub routing number without context keyword', () => {
    const messages = [
      { role: 'user', content: 'order 021000021 shipped' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'order 021000021 shipped');
    assert.equal(scrubCount, 0);
  });

  // ── Bank account number (new) ──────────────────────────────

  it('scrubs account number with context keyword', () => {
    const messages = [
      { role: 'user', content: 'checking account 12345678901' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'checking account [ACCOUNT_REDACTED]');
    assert.equal(scrubCount, 1);
  });

  it('does not scrub account number without context keyword', () => {
    const messages = [
      { role: 'user', content: 'invoice 12345678901 is due' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'invoice 12345678901 is due');
    assert.equal(scrubCount, 0);
  });

  // ── Passport number (new) ─────────────────────────────────

  it('scrubs passport number with context keyword', () => {
    const messages = [
      { role: 'user', content: 'passport AB1234567 expires next year' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'passport [PASSPORT_REDACTED] expires next year');
    assert.equal(scrubCount, 1);
  });

  it('does not scrub passport-like string without keyword', () => {
    const messages = [
      { role: 'user', content: 'confirmation code AB1234567' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'confirmation code AB1234567');
    assert.equal(scrubCount, 0);
  });

  // ── DOB (kept, updated to preserve keyword prefix) ────────

  it('scrubs DOB with context keyword', () => {
    const messages = [
      { role: 'user', content: 'DOB: 03/15/1988' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'DOB: [DOB_REDACTED]');
    assert.equal(scrubCount, 1);
  });

  it('does not scrub date without DOB context', () => {
    const messages = [
      { role: 'user', content: 'the auction is on 03/15/1988' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'the auction is on 03/15/1988');
    assert.equal(scrubCount, 0);
  });

  // ── Mixed financial PII ───────────────────────────────────

  it('scrubs mixed financial PII and returns correct count', () => {
    const messages = [
      {
        role: 'user',
        content:
          'SSN 123-45-6789, card 4111111111111111, routing 021000021',
      },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(
      result[0].content,
      'SSN [SSN_REDACTED], card [CC_REDACTED], routing [ROUTING_REDACTED]'
    );
    assert.equal(scrubCount, 3);
  });

  // ── Operational PII must NOT be scrubbed (regression) ─────

  it('does not scrub phone numbers', () => {
    const messages = [
      { role: 'user', content: 'Call contractor at (703) 555-1234' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Call contractor at (703) 555-1234');
    assert.equal(scrubCount, 0);
  });

  it('does not scrub email addresses', () => {
    const messages = [
      { role: 'user', content: 'Email me at bob@example.com' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Email me at bob@example.com');
    assert.equal(scrubCount, 0);
  });

  it('does not scrub street addresses', () => {
    const messages = [
      { role: 'user', content: 'Pickup at 456 Oak Avenue, Arlington VA' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Pickup at 456 Oak Avenue, Arlington VA');
    assert.equal(scrubCount, 0);
  });

  it('does not scrub URLs', () => {
    const messages = [
      { role: 'user', content: 'Check https://auction.gov/lot?id=9382' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Check https://auction.gov/lot?id=9382');
    assert.equal(scrubCount, 0);
  });

  it('does not scrub coordinates', () => {
    const messages = [
      { role: 'user', content: 'Meet at 38.8799, -77.1068' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'Meet at 38.8799, -77.1068');
    assert.equal(scrubCount, 0);
  });

  // ── General behavior (updated for Tier 1 patterns) ────────

  it('returns unchanged messages when no PII is present', () => {
    const messages = [
      { role: 'user', content: 'Hello, how are you today?' },
      { role: 'assistant', content: 'I am fine, thank you!' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.deepEqual(result, messages);
    assert.equal(scrubCount, 0);
  });

  it('scrubs text items in multimodal content arrays', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'My SSN is 123-45-6789' },
          { type: 'image_url', image_url: { url: 'https://img.example.com/pic.png' } },
          { type: 'text', text: 'Card 4111 1111 1111 1111' },
        ],
      },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content[0].text, 'My SSN is [SSN_REDACTED]');
    assert.deepEqual(result[0].content[1], messages[0].content[1]);
    assert.equal(result[0].content[2].text, 'Card [CC_REDACTED]');
    assert.equal(scrubCount, 2);
  });

  it('scrubs system and assistant messages', () => {
    const messages = [
      { role: 'system', content: 'User SSN is 111-22-3333' },
      { role: 'assistant', content: 'Card on file: 4111111111111111' },
    ];
    const { messages: result, scrubCount } = scrubMessages(messages);
    assert.equal(result[0].content, 'User SSN is [SSN_REDACTED]');
    assert.equal(result[1].content, 'Card on file: [CC_REDACTED]');
    assert.equal(scrubCount, 2);
  });

  it('handles empty messages array', () => {
    const { messages: result, scrubCount } = scrubMessages([]);
    assert.deepEqual(result, []);
    assert.equal(scrubCount, 0);
  });

  it('does not mutate the original messages array', () => {
    const original = [{ role: 'user', content: 'SSN: 123-45-6789' }];
    const copy = JSON.parse(JSON.stringify(original));
    scrubMessages(original);
    assert.deepEqual(original, copy);
  });

  it('preserves non-content fields like role, name, tool_calls', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'SSN 999-88-7777',
        name: 'helper',
        tool_calls: [{ id: 'tc1', function: { name: 'search' } }],
      },
    ];
    const { messages: result } = scrubMessages(messages);
    assert.equal(result[0].role, 'assistant');
    assert.equal(result[0].name, 'helper');
    assert.deepEqual(result[0].tool_calls, messages[0].tool_calls);
    assert.equal(result[0].content, 'SSN [SSN_REDACTED]');
  });
});
