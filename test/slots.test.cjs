/**
 * Tests for the slot computation, formatting and free-text date parsing.
 * Working hours are defined in local time, so pin the process zone.
 */
process.env.TZ = 'Europe/Berlin';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeFreeSlots, formatSlots, resolveRange, parseWhen, isInPerson, zoneAbbr } = require('../popup/slots.js');

// Tuesday 2026-09-08, local time
const day = (h, m = 0, d = 8) => new Date(2026, 8, d, h, m);
const iso = (d) => d.toISOString();
const ev = (start, end, extra = {}) => ({ calendarId: 'c1', title: 'Call', start: iso(start), end: iso(end), allDay: false, location: '', transparent: false, cancelled: false, declined: false, ...extra });

const base = {
  rangeStart: new Date(2026, 8, 8),
  rangeEnd: new Date(2026, 8, 9),
  workStart: '10:00', workEnd: '18:00',
  durationMin: 30, bufferMin: 15, commuteBufferMin: 60, leadMin: 60, roundMin: 15,
  now: new Date(2026, 8, 7, 9, 0),
};

const windows = (days) => days.flatMap(d => d.windows.map(w => `${w.start.getHours()}:${String(w.start.getMinutes()).padStart(2, '0')}-${w.end.getHours()}:${String(w.end.getMinutes()).padStart(2, '0')}`));

describe('computeFreeSlots', () => {
  it('returns the whole working day when empty', () => {
    assert.deepEqual(windows(computeFreeSlots([], base)), ['10:00-18:00']);
  });
  it('applies a 15 min buffer around virtual meetings', () => {
    const days = computeFreeSlots([ev(day(12), day(13), { location: 'https://zoom.us/j/1' })], base);
    assert.deepEqual(windows(days), ['10:00-11:45', '13:15-18:00']);
  });
  it('applies a 60 min buffer around in-person meetings', () => {
    const days = computeFreeSlots([ev(day(12), day(13), { location: 'Main Street 1, Springfield' })], base);
    assert.deepEqual(windows(days), ['10:00-11:00', '14:00-18:00']);
  });
  it('applies the commute buffer everywhere when the new meeting is in person', () => {
    const days = computeFreeSlots([ev(day(12), day(13))], { ...base, inPersonNew: true });
    assert.deepEqual(windows(days), ['10:00-11:00', '14:00-18:00']);
  });
  it('ignores declined, cancelled and transparent events', () => {
    const days = computeFreeSlots([
      ev(day(11), day(12), { declined: true }),
      ev(day(13), day(14), { cancelled: true }),
      ev(day(15), day(16), { transparent: true }),
    ], base);
    assert.deepEqual(windows(days), ['10:00-18:00']);
  });
  it('drops windows shorter than the duration', () => {
    const days = computeFreeSlots([ev(day(10, 30), day(11)), ev(day(11, 45), day(17, 30))], base);
    assert.deepEqual(windows(days), []);
  });
  it('blocks whole days for vacation all-day events but not birthdays', () => {
    const allDay = (title, d) => ({ calendarId: 'c1', title, start: iso(new Date(2026, 8, d)), end: iso(new Date(2026, 8, d + 1)), allDay: true, transparent: false, cancelled: false, declined: false });
    const days = computeFreeSlots([allDay('Vacation', 8), allDay("Alex's birthday", 9)], { ...base, rangeEnd: new Date(2026, 8, 10) });
    assert.equal(days.length, 1);
    assert.equal(days[0].day.getDate(), 9);
  });
  it('skips weekends and past times', () => {
    const opts = { ...base, rangeStart: new Date(2026, 8, 4), rangeEnd: new Date(2026, 8, 8), now: new Date(2026, 8, 4, 13, 10) };
    const days = computeFreeSlots([], opts);
    assert.deepEqual(days.map(d => d.day.getDate()), [4, 7]);
    assert.deepEqual(windows(days), ['14:15-18:00', '10:00-18:00']);
  });
  it('respects the calendar filter', () => {
    const days = computeFreeSlots([ev(day(12), day(13), { calendarId: 'other' })], { ...base, calendarIds: new Set(['c1']) });
    assert.deepEqual(windows(days), ['10:00-18:00']);
  });
});

describe('isInPerson', () => {
  it('treats URLs and conferencing tools as virtual', () => {
    assert.equal(isInPerson({ location: 'https://meet.google.com/abc' }), false);
    assert.equal(isInPerson({ location: 'Microsoft Teams Meeting' }), false);
    assert.equal(isInPerson({ location: 'Google Meet (instructions in description)' }), false);
    assert.equal(isInPerson({ location: '' }), false);
    assert.equal(isInPerson({ location: 'Science Park 8, Amsterdam' }), true);
    assert.equal(isInPerson({ location: '', title: 'Lunch with Sam' }), true);
  });
});

describe('formatSlots', () => {
  const sample = [{ day: day(0), windows: [{ start: day(10), end: day(12) }, { start: day(14, 30), end: day(18) }] }];
  it('formats German output in the local zone', () => {
    assert.deepEqual(formatSlots(sample, { lang: 'de' }), [
      'Folgende Zeiten würden mir passen (alle Zeiten CEST):',
      '',
      'Di 08.09.: 10:00–12:00, 14:30–18:00',
    ]);
  });
  it('formats English output without intro', () => {
    assert.deepEqual(formatSlots(sample, { lang: 'en', intro: false }), ['Tue 8 Sep: 10:00–12:00, 14:30–18:00']);
  });
  it('converts to Pacific Time with 12-hour clock and US date order', () => {
    assert.deepEqual(formatSlots(sample, { lang: 'en', zone: 'PT' }), [
      'The following times would work for me (all times Pacific Time (PDT)):',
      '',
      'Tue, Sep 8: 1:00–3:00 AM, 5:30–9:00 AM',
    ]);
  });
  it('converts to Eastern Time across the noon boundary', () => {
    const noon = [{ day: day(0), windows: [{ start: day(16), end: day(18) }] }];
    assert.deepEqual(formatSlots(noon, { lang: 'en', zone: 'ET', intro: false }), ['Tue, Sep 8: 10:00 AM–12:00 PM']);
  });
  it('appends the local time in brackets when asked', () => {
    const one = [{ day: day(0), windows: [{ start: day(16), end: day(18) }] }];
    assert.deepEqual(formatSlots(one, { lang: 'en', zone: 'ET', intro: false, alsoHome: true }), ['Tue, Sep 8: 10:00 AM–12:00 PM (16:00–18:00 CEST)']);
  });
  it('keeps 24-hour clock for UK and regroups Asian zones by their local date', () => {
    assert.deepEqual(formatSlots(sample, { lang: 'en', zone: 'UK', intro: false }), ['Tue 8 Sep: 09:00–11:00, 13:30–17:00']);
    const late = [{ day: day(0), windows: [{ start: day(17), end: day(18) }] }];
    assert.deepEqual(formatSlots(late, { lang: 'en', zone: 'JST', intro: false }), ['Wed 9 Sep: 00:00–01:00']);
  });
  it('uses winter abbreviations in January', () => {
    const jan = new Date(2027, 0, 12, 10);
    assert.equal(zoneAbbr(jan, 'LOCAL'), 'CET');
    assert.equal(zoneAbbr(jan, 'PT'), 'PST');
    assert.equal(zoneAbbr(jan, 'UK'), 'GMT');
  });
});

describe('parseWhen', () => {
  const now = new Date(2026, 8, 9, 11, 0); // Wednesday 9 Sep 2026, 11:00
  const fmt = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null;

  it('understands German date formats', () => {
    assert.equal(fmt(parseWhen('14.9. 15:00', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('14.09.2026 15:00', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('14.9 15:00', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('14.9.', now)), '2026-09-14 10:00');
    assert.equal(fmt(parseWhen('3.1. 9:30', now)), '2027-01-03 09:30');
  });
  it('understands English date formats', () => {
    assert.equal(fmt(parseWhen('14 Sep 15:00', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('Sep 14 3pm', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('September 14th 2026 3:30 pm', now)), '2026-09-14 15:30');
    assert.equal(fmt(parseWhen('9/14 15:00', now)), '2026-09-14 15:00');
    assert.equal(fmt(parseWhen('2026-09-14 15:00', now)), '2026-09-14 15:00');
  });
  it('understands weekdays and relative days', () => {
    assert.equal(fmt(parseWhen('Di 15:00', now)), '2026-09-15 15:00');
    assert.equal(fmt(parseWhen('Mi 15:00', now)), '2026-09-09 15:00');
    assert.equal(fmt(parseWhen('Mi 9:00', now)), '2026-09-16 09:00');
    assert.equal(fmt(parseWhen('nächsten Mi 9:00', now)), '2026-09-16 09:00');
    assert.equal(fmt(parseWhen('Friday 4pm', now)), '2026-09-11 16:00');
    assert.equal(fmt(parseWhen('morgen 10:30', now)), '2026-09-10 10:30');
    assert.equal(fmt(parseWhen('tomorrow 3:15 pm', now)), '2026-09-10 15:15');
    assert.equal(fmt(parseWhen('übermorgen 15 uhr', now)), '2026-09-11 15:00');
  });
  it('treats a bare time as today or, if past, tomorrow', () => {
    assert.equal(fmt(parseWhen('15:00', now)), '2026-09-09 15:00');
    assert.equal(fmt(parseWhen('9:00', now)), '2026-09-10 09:00');
  });
  it('rejects nonsense', () => {
    assert.equal(parseWhen('', now), null);
    assert.equal(parseWhen('call with the team about the roadmap', now), null);
    assert.equal(parseWhen('25:00', now), null);
  });
});

describe('resolveRange', () => {
  it('computes this week and next week from a Wednesday', () => {
    const now = new Date(2026, 8, 2, 11, 0);
    const [a, b] = resolveRange('thisWeek', now);
    assert.deepEqual([a.getDate(), b.getDate()], [2, 5]);
    const [c, d] = resolveRange('nextWeek', now);
    assert.deepEqual([c.getDate(), d.getDate()], [7, 12]);
  });
});
