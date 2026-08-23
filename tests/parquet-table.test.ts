import { describe, expect, it } from 'vitest';
import { cellText } from '../src/shared/cell-text';

describe('parquet table cellText', () => {
  it('renders INT64 bigints as plain numbers', () => {
    expect(cellText(15653890n)).toBe('15653890');
    expect(cellText(65n)).toBe('65');
  });

  it('formats DATE columns (UTC midnight) as the day only', () => {
    expect(cellText(new Date('2026-08-25T00:00:00.000Z'))).toBe('2026-08-25');
  });

  it('keeps the time for timestamp values', () => {
    expect(cellText(new Date('2026-08-25T14:30:45.123Z'))).toBe('2026-08-25 14:30:45 UTC');
  });

  it('serializes nested objects BigInt-safe', () => {
    expect(cellText({ tags: ['a', 12n] })).toBe('{"tags":["a","12"]}');
  });

  it('renders nulls, booleans, numbers, and strings as-is', () => {
    expect(cellText('NIFTY')).toBe('NIFTY');
    expect(cellText(21200)).toBe('21200');
    expect(cellText(true)).toBe('true');
    expect(cellText(null)).toBe('null');
  });
});
