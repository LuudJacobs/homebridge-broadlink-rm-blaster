import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatLastSeen } from '../src/mqttLastSeen';

const FIXED_DATE = new Date('2026-08-18T14:23:01.500Z');

test('formatLastSeen: iso8601 matches Date.toISOString (UTC)', () => {
  assert.equal(formatLastSeen('iso8601', FIXED_DATE), '2026-08-18T14:23:01.500Z');
});

test('formatLastSeen: epoch returns the millisecond timestamp', () => {
  assert.equal(formatLastSeen('epoch', FIXED_DATE), FIXED_DATE.getTime());
});

test('formatLastSeen: disabled returns undefined', () => {
  assert.equal(formatLastSeen('disabled', FIXED_DATE), undefined);
});

test('formatLastSeen: iso8601local has the right shape and offset sign matches the local timezone', () => {
  const result = formatLastSeen('iso8601local', FIXED_DATE);
  assert.equal(typeof result, 'string');
  assert.match(result as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);

  const offsetMinutes = -FIXED_DATE.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  assert.ok((result as string).includes(sign === '+' ? '+' : '-'));
});

test('formatLastSeen: iso8601local reflects local wall-clock fields, not UTC ones', () => {
  const result = formatLastSeen('iso8601local', FIXED_DATE) as string;
  const expectedYear = String(FIXED_DATE.getFullYear());
  const expectedMonth = String(FIXED_DATE.getMonth() + 1).padStart(2, '0');
  const expectedDay = String(FIXED_DATE.getDate()).padStart(2, '0');
  assert.ok(result.startsWith(`${expectedYear}-${expectedMonth}-${expectedDay}T`));
});
