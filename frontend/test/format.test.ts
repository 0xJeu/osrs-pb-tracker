import { describe, expect, it } from 'vitest';
import { formatTime, formatDate, titleCase } from '../src/lib/format';

describe('formatTime', () => {
  it('formats sub-minute times', () => {
    expect(formatTime(5)).toBe('0:05');
  });

  it('formats minute times', () => {
    expect(formatTime(80)).toBe('1:20');
    expect(formatTime(1238)).toBe('20:38');
  });

  it('formats hour-plus times as h:mm:ss', () => {
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('keeps two decimals only for fractional seconds', () => {
    expect(formatTime(94.2)).toBe('1:34.20');
    expect(formatTime(118.4)).toBe('1:58.40');
    expect(formatTime(90)).toBe('1:30');
  });
});

describe('formatDate', () => {
  it('renders a valid ISO date via toLocaleString', () => {
    const iso = '2026-07-04T18:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('falls back to the raw value for unparseable input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('titleCase', () => {
  it('capitalizes each word', () => {
    expect(titleCase('theatre of blood')).toBe('Theatre Of Blood');
  });
});
