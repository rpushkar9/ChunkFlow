'use strict';

const Utils = require('../web_plugin_22_full_functionality/utils.js');

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
