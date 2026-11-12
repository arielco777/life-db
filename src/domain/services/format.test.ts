import { formatDuration, formatNumber, formatPercent, formatValue, parseDuration } from './format';

describe('formatDuration', () => {
  it('long form', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(763)).toBe('12h 43m');
    expect(formatDuration(24.6)).toBe('25m');
  });
  it('compact form for grid cells', () => {
    expect(formatDuration(45, 'compact')).toBe('45m');
    expect(formatDuration(90, 'compact')).toBe('1h30');
    expect(formatDuration(65, 'compact')).toBe('1h05');
    expect(formatDuration(120, 'compact')).toBe('2h');
  });
});

describe('parseDuration', () => {
  it.each([
    ['45', 45],
    [' 45 ', 45],
    ['45m', 45],
    ['45 min', 45],
    ['0:45', 45],
    ['1:30', 90],
    ['1h', 60],
    ['1.5h', 90],
    ['1,5h', 90],
    ['2 hours', 120],
    ['1h30', 90],
    ['1h 30m', 90],
    ['1 h 30 min', 90],
    ['0', 0],
  ])('%s → %i minutes', (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it.each(['', 'abc', '-5', '1:75', '1:5', 'h30', '1.5', '1h30h'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('formatValue (MON-1)', () => {
  const en = { locale: 'en-US' };
  it('boolean', () => {
    expect(formatValue({ type: 'boolean' }, 1)).toBe('✓');
    expect(formatValue({ type: 'boolean' }, 0)).toBe('✗');
  });
  it('number with and without unit', () => {
    expect(formatValue({ type: 'number', unit: 'L' }, 2.5, en)).toBe('2.5 L');
    expect(formatValue({ type: 'number', unit: 'L' }, 2.5, { ...en, compact: true })).toBe('2.5');
    expect(formatValue({ type: 'number' }, 1 / 3, en)).toBe('0.33');
    expect(formatValue({ type: 'number', unit: 'cups' }, 3, { locale: 'de-DE' })).toBe('3 cups');
    expect(formatValue({ type: 'number' }, 2.5, { locale: 'de-DE' })).toBe('2,5');
  });
  it('duration', () => {
    expect(formatValue({ type: 'duration' }, 90)).toBe('1h 30m');
    expect(formatValue({ type: 'duration' }, 90, { compact: true })).toBe('1h30');
  });
  it('rating', () => {
    expect(formatValue({ type: 'rating', ratingScale: { min: 1, max: 10 } }, 8, en)).toBe('8/10');
    expect(formatValue({ type: 'rating', ratingScale: { min: 1, max: 5 } }, 4, en)).toBe('4/5');
    expect(formatValue({ type: 'rating' }, 7.25, { ...en, compact: true })).toBe('7.3');
  });
});

describe('number helpers', () => {
  it('formats numbers and percentages', () => {
    expect(formatNumber(6.8333, 1, 'en-US')).toBe('6.8');
    expect(formatPercent(18 / 31, 'en-US')).toBe('58%');
  });
});
