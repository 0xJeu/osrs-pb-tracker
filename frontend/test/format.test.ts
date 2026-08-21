import { describe, expect, it } from 'vitest';
import { formatTime, formatDate, formatPbValue, isDeepestDelveBoss, titleCase } from '../src/lib/format';

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

describe('formatPbValue', () => {
  it('formats the deepest delve record as a depth level, not a duration', () => {
    expect(isDeepestDelveBoss('doom of mokhaiotl deepest delve')).toBe(true);
    expect(isDeepestDelveBoss('Doom Of Mokhaiotl Deepest Delve')).toBe(true);
    expect(formatPbValue('doom of mokhaiotl deepest delve', 260)).toBe('Delve 260');
  });

  it('formats every other boss, including the base Doom of Mokhaiotl PB, as a time', () => {
    expect(isDeepestDelveBoss('doom of mokhaiotl')).toBe(false);
    expect(formatPbValue('doom of mokhaiotl', 340.4)).toBe(formatTime(340.4));
    expect(formatPbValue('zulrah', 80)).toBe(formatTime(80));
  });
});

describe('titleCase', () => {
  it('capitalizes each word', () => {
    expect(titleCase('theatre of blood')).toBe('Theatre Of Blood');
  });
});
