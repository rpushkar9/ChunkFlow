'use strict';

const Utils = require('../extension/utils.js');

// ── formatFileSize ────────────────────────────────────────────────────────────
describe('Utils.formatFileSize', () => {
  test('0 bytes', () => {
    expect(Utils.formatFileSize(0)).toBe('0 Bytes');
  });

  test('1 KB', () => {
    expect(Utils.formatFileSize(1024)).toBe('1 KB');
  });

  test('1.5 MB', () => {
    expect(Utils.formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
  });

  test('1 GB', () => {
    expect(Utils.formatFileSize(1024 ** 3)).toBe('1 GB');
  });
});

// ── validateUrl ───────────────────────────────────────────────────────────────
describe('Utils.validateUrl', () => {
  test('valid https URL', () => {
    expect(Utils.validateUrl('https://example.com/file.zip')).toBe(true);
  });

  test('valid http URL', () => {
    expect(Utils.validateUrl('http://example.com')).toBe(true);
  });

  test('invalid: plain string', () => {
    expect(Utils.validateUrl('not-a-url')).toBe(false);
  });

  test('invalid: empty string', () => {
    expect(Utils.validateUrl('')).toBe(false);
  });
});

// ── isHttpOrHttpsUrl ─────────────────────────────────────────────────────────
describe('Utils.isHttpOrHttpsUrl', () => {
  test('accepts https URL', () => {
    expect(Utils.isHttpOrHttpsUrl('https://example.com/file.zip')).toBe(true);
  });

  test('accepts http URL', () => {
    expect(Utils.isHttpOrHttpsUrl('http://example.com')).toBe(true);
  });

  test('rejects non-http scheme', () => {
    expect(Utils.isHttpOrHttpsUrl('ftp://example.com/file.zip')).toBe(false);
    expect(Utils.isHttpOrHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(Utils.isHttpOrHttpsUrl('blob:https://example.com/abc')).toBe(false);
  });

  test('rejects invalid URL', () => {
    expect(Utils.isHttpOrHttpsUrl('not-a-url')).toBe(false);
  });
});

// ── sanitizeFilename ──────────────────────────────────────────────────────────
describe('Utils.sanitizeFilename', () => {
  test('replaces forbidden chars with underscores', () => {
    expect(Utils.sanitizeFilename('my<bad>file:name.zip')).toBe('my_bad_file_name.zip');
  });

  test('leaves clean filename untouched', () => {
    expect(Utils.sanitizeFilename('clean_file.pdf')).toBe('clean_file.pdf');
  });

  test('truncates to 255 chars', () => {
    const long = 'a'.repeat(300);
    expect(Utils.sanitizeFilename(long).length).toBe(255);
  });
});

// ── getFileExtension ──────────────────────────────────────────────────────────
describe('Utils.getFileExtension', () => {
  test('returns lowercase extension', () => {
    expect(Utils.getFileExtension('Report.PDF')).toBe('pdf');
  });

  test('returns empty string for no extension', () => {
    expect(Utils.getFileExtension('Makefile')).toBe('');
  });

  test('handles multiple dots (returns last)', () => {
    expect(Utils.getFileExtension('archive.tar.gz')).toBe('gz');
  });
});

// ── isImageFile ───────────────────────────────────────────────────────────────
describe('Utils.isImageFile', () => {
  test('png is an image', () => {
    expect(Utils.isImageFile('photo.png')).toBe(true);
  });

  test('webp is an image', () => {
    expect(Utils.isImageFile('banner.webp')).toBe(true);
  });

  test('pdf is not an image', () => {
    expect(Utils.isImageFile('report.pdf')).toBe(false);
  });

  test('zip is not an image', () => {
    expect(Utils.isImageFile('archive.zip')).toBe(false);
  });
});

// ── clampChunkCount ───────────────────────────────────────────────────────────
describe('Utils.clampChunkCount', () => {
  test('returns default (10) when called with no args', () => {
    expect(Utils.clampChunkCount(undefined)).toBe(10);
  });

  test('returns default for NaN', () => {
    expect(Utils.clampChunkCount('abc')).toBe(10);
  });

  test('clamps below minimum to 2', () => {
    expect(Utils.clampChunkCount(0)).toBe(10); // 0 treated as missing → default
    expect(Utils.clampChunkCount(1)).toBe(2);
  });

  test('clamps above maximum to 32', () => {
    expect(Utils.clampChunkCount(100)).toBe(32);
  });

  test('valid mid-range value passes through', () => {
    expect(Utils.clampChunkCount(8)).toBe(8);
    expect(Utils.clampChunkCount(16)).toBe(16);
  });

  test('boundary values: exactly 2 and 32', () => {
    expect(Utils.clampChunkCount(2)).toBe(2);
    expect(Utils.clampChunkCount(32)).toBe(32);
  });

  test('rounds float to nearest integer', () => {
    expect(Utils.clampChunkCount(7.6)).toBe(8);
    expect(Utils.clampChunkCount(7.2)).toBe(7);
  });

  test('respects custom min/max/default', () => {
    expect(Utils.clampChunkCount(50, 1, 20, 5)).toBe(20);
    expect(Utils.clampChunkCount(undefined, 1, 20, 5)).toBe(5);
  });
});

// ── pending mode queue helpers ────────────────────────────────────────────────
describe('Utils.selectPendingMode', () => {
  const entry = (mode, at, sourceUrl) => ({ mode, at, sourceUrl });

  test('prefers an exact sourceUrl match over the oldest entry', () => {
    const queue = [
      entry('normal', 100, 'https://a.com/1.zip'),
      entry('chunked', 200, 'blob:x'),
    ];
    const { entry: picked, remaining } = Utils.selectPendingMode(queue, 'blob:x', 0);
    expect(picked.mode).toBe('chunked');
    expect(remaining).toEqual([entry('normal', 100, 'https://a.com/1.zip')]);
  });

  test('falls back to the oldest fresh entry when no URL matches', () => {
    const queue = [entry('normal', 100, 'https://a.com/1.zip'), entry('fallback', 200, 'https://a.com/2.zip')];
    const { entry: picked, remaining } = Utils.selectPendingMode(queue, 'https://other.com/x', 0);
    expect(picked.mode).toBe('normal');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].mode).toBe('fallback');
  });

  test('drops entries at or before minTimestamp', () => {
    const queue = [entry('normal', 50, 'https://a.com/1.zip'), entry('chunked', 150, 'https://a.com/2.zip')];
    const { entry: picked } = Utils.selectPendingMode(queue, 'https://a.com/1.zip', 100);
    expect(picked.mode).toBe('chunked'); // the stale (50) entry is filtered out first
  });

  test('empty / missing queue yields a null entry', () => {
    expect(Utils.selectPendingMode([], 'x', 0).entry).toBeNull();
    expect(Utils.selectPendingMode(undefined, 'x', 0).entry).toBeNull();
  });
});

describe('Utils.removePendingMode', () => {
  const entry = (mode, sourceUrl) => ({ mode, at: 1, sourceUrl });

  test('removes the newest entry matching sourceUrl', () => {
    const queue = [entry('normal', 'u1'), entry('fallback', 'u1'), entry('chunked', 'u2')];
    const result = Utils.removePendingMode(queue, 'u1');
    expect(result).toEqual([entry('normal', 'u1'), entry('chunked', 'u2')]);
  });

  test('leaves the queue unchanged when nothing matches', () => {
    const queue = [entry('normal', 'u1')];
    expect(Utils.removePendingMode(queue, 'nope')).toEqual(queue);
  });

  test('does not mutate the input queue', () => {
    const queue = [entry('normal', 'u1')];
    Utils.removePendingMode(queue, 'u1');
    expect(queue).toHaveLength(1);
  });
});

// ── parseContentRange ─────────────────────────────────────────────────────────
describe('Utils.parseContentRange', () => {
  test('parses a normal range', () => {
    expect(Utils.parseContentRange('bytes 0-1023/4096')).toEqual({ start: 0, end: 1023, total: 4096 });
  });

  test('unknown total (*) yields null total', () => {
    expect(Utils.parseContentRange('bytes 100-199/*')).toEqual({ start: 100, end: 199, total: null });
  });

  test('is case-insensitive on the "bytes" unit', () => {
    expect(Utils.parseContentRange('Bytes 5-10/20')).toEqual({ start: 5, end: 10, total: 20 });
  });

  test('returns null for malformed / missing values', () => {
    expect(Utils.parseContentRange('items 0-1/2')).toBeNull();
    expect(Utils.parseContentRange('bytes 0-/10')).toBeNull();
    expect(Utils.parseContentRange('')).toBeNull();
    expect(Utils.parseContentRange(null)).toBeNull();
    expect(Utils.parseContentRange(undefined)).toBeNull();
  });
});

// ── headAdvertisesByteRanges ──────────────────────────────────────────────────
describe('Utils.headAdvertisesByteRanges', () => {
  const resp = (headers) => ({ headers: { get: (k) => (k in headers ? headers[k] : null) } });

  test('true when Accept-Ranges: bytes', () => {
    expect(Utils.headAdvertisesByteRanges(resp({ 'Accept-Ranges': 'bytes' }))).toBe(true);
  });

  test('true when bytes appears in a token list', () => {
    expect(Utils.headAdvertisesByteRanges(resp({ 'Accept-Ranges': 'none, bytes' }))).toBe(true);
  });

  test('case-insensitive', () => {
    expect(Utils.headAdvertisesByteRanges(resp({ 'Accept-Ranges': 'BYTES' }))).toBe(true);
  });

  test('false for "none", empty, or missing header', () => {
    expect(Utils.headAdvertisesByteRanges(resp({ 'Accept-Ranges': 'none' }))).toBe(false);
    expect(Utils.headAdvertisesByteRanges(resp({ 'Accept-Ranges': '' }))).toBe(false);
    expect(Utils.headAdvertisesByteRanges(resp({}))).toBe(false);
  });
});

// ── computeOffscreenTimeoutMs ─────────────────────────────────────────────────
describe('Utils.computeOffscreenTimeoutMs', () => {
  const MIN = 3 * 60 * 1000;
  const MAX = 15 * 60 * 1000;

  test('clamps a tiny file to the minimum timeout', () => {
    expect(Utils.computeOffscreenTimeoutMs(1024, 10, 0)).toBe(MIN);
  });

  test('clamps a very large file to the maximum timeout', () => {
    expect(Utils.computeOffscreenTimeoutMs(500 * 1024 * 1024, 32, 3)).toBe(MAX);
  });

  test('always returns a value within [MIN, MAX]', () => {
    for (const size of [0, 5e6, 5e7, 2e8, 5e8]) {
      const t = Utils.computeOffscreenTimeoutMs(size, 10, 0);
      expect(t).toBeGreaterThanOrEqual(MIN);
      expect(t).toBeLessThanOrEqual(MAX);
    }
  });

  test('more chunks never decrease the timeout', () => {
    const size = 50 * 1024 * 1024;
    expect(Utils.computeOffscreenTimeoutMs(size, 16, 0)).toBeGreaterThanOrEqual(
      Utils.computeOffscreenTimeoutMs(size, 4, 0)
    );
  });

  test('retry attempts add a bonus (never decrease the timeout)', () => {
    const size = 100 * 1024 * 1024;
    expect(Utils.computeOffscreenTimeoutMs(size, 10, 2)).toBeGreaterThanOrEqual(
      Utils.computeOffscreenTimeoutMs(size, 10, 0)
    );
  });
});
