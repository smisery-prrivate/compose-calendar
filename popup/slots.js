/**
 * Free-slot computation, free-text date parsing and formatting for Compose Calendar.
 * Pure functions, no browser APIs, so the same file runs under node for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ComposeCalendarSlots = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN = 60000;

  // Locations that mean "no travel needed"
  const VIRTUAL_RE = /https?:\/\/|zoom|\bmeet\b|hangout|teams|webex|skype|whereby|jitsi|gotomeeting|webinar|telefon|phone|call|online|virtual|remote|video/i;
  // Titles that mean "I am physically somewhere else"
  const ONSITE_TITLE_RE = /vor ort|on-?site|besuch|visit|termin bei|meeting bei|mittagessen|lunch|dinner|abendessen|arzt|zahnarzt|doctor|dentist/i;
  // All-day events that block the whole day (birthdays etc. do not)
  const BLOCKING_ALLDAY_RE = /urlaub|vacation|holiday|feiertag|out of office|\booo\b|abwesend|krank|sick|reise|trip|travel|konferenz|conference|offsite|messe|workshop|retreat|klausur/i;

  let localTz = "UTC";
  try { localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }

  // Output time zones offered in the popup. LOCAL is the machine's zone, in which working hours are defined.
  const ZONES = {
    LOCAL: { tz: localTz, name: "local time", home: true },
    CET: { tz: "Europe/Berlin", name: "Central European Time" },
    UK: { tz: "Europe/London", name: "UK time" },
    ET: { tz: "America/New_York", name: "Eastern Time" },
    CT: { tz: "America/Chicago", name: "Central Time" },
    MT: { tz: "America/Denver", name: "Mountain Time" },
    PT: { tz: "America/Los_Angeles", name: "Pacific Time" },
    IST: { tz: "Asia/Kolkata", name: "India Standard Time" },
    SGT: { tz: "Asia/Singapore", name: "Singapore Time" },
    JST: { tz: "Asia/Tokyo", name: "Japan Standard Time" },
    AEST: { tz: "Australia/Sydney", name: "Sydney time" },
  };
  const HOME_ZONE = "LOCAL";

  function parseHM(hm) {
    const [h, m] = String(hm).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function atMinutes(day, minutes) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    d.setMinutes(minutes);
    return d;
  }

  function isInPerson(ev) {
    const loc = (ev.location || "").trim();
    if (loc && !VIRTUAL_RE.test(loc)) return true;
    return ONSITE_TITLE_RE.test(ev.title || "");
  }

  function blocksWholeDay(ev) {
    return BLOCKING_ALLDAY_RE.test(ev.title || "");
  }

  function ceilTo(date, stepMin) {
    const step = stepMin * MIN;
    return new Date(Math.ceil(date.getTime() / step) * step);
  }

  function floorTo(date, stepMin) {
    const step = stepMin * MIN;
    return new Date(Math.floor(date.getTime() / step) * step);
  }

  function mergeIntervals(intervals) {
    const sorted = intervals.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
    const out = [];
    for (const iv of sorted) {
      const last = out[out.length - 1];
      if (last && iv.start <= last.end) {
        if (iv.end > last.end) last.end = iv.end;
      } else {
        out.push({ start: new Date(iv.start), end: new Date(iv.end) });
      }
    }
    return out;
  }

  /**
   * @param {Array} events  from composeCalendar.getBusyEvents
   * @param {Object} opts
   *   rangeStart, rangeEnd: Date (rangeEnd exclusive)
   *   workStart, workEnd: "HH:MM" in local time
   *   durationMin, bufferMin, commuteBufferMin, leadMin, roundMin: numbers
   *   inPersonNew: boolean, the appointment being scheduled needs travel
   *   calendarIds: Set|null, restrict to these calendars
   *   now: Date
   * @returns {Array<{day: Date, windows: Array<{start: Date, end: Date}>}>}
   */
  function computeFreeSlots(events, opts) {
    const workStart = parseHM(opts.workStart || "09:00");
    const workEnd = parseHM(opts.workEnd || "17:00");
    const duration = opts.durationMin || 30;
    const buffer = opts.bufferMin ?? 15;
    const commute = opts.commuteBufferMin ?? 60;
    const lead = opts.leadMin ?? 60;
    const round = opts.roundMin || 15;
    const now = opts.now || new Date();
    const earliest = ceilTo(new Date(now.getTime() + lead * MIN), round);

    const relevant = events.filter(ev => {
      if (opts.calendarIds && !opts.calendarIds.has(ev.calendarId)) return false;
      if (ev.cancelled || ev.declined || ev.transparent) return false;
      return ev.start && ev.end;
    });

    const days = [];
    const cursor = new Date(opts.rangeStart.getFullYear(), opts.rangeStart.getMonth(), opts.rangeStart.getDate());
    while (cursor < opts.rangeEnd) {
      const day = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue;

      let dayStart = atMinutes(day, workStart);
      const dayEnd = atMinutes(day, workEnd);
      if (dayStart < earliest) dayStart = earliest;
      if (dayEnd <= dayStart) continue;

      const busy = [];
      let blocked = false;
      for (const ev of relevant) {
        const s = new Date(ev.start);
        const e = new Date(ev.end);
        if (ev.allDay) {
          if (s <= day && e > day && blocksWholeDay(ev)) { blocked = true; break; }
          continue;
        }
        if (e <= dayStart || s >= dayEnd) continue;
        const pad = opts.inPersonNew ? Math.max(buffer, commute) : (isInPerson(ev) ? commute : buffer);
        busy.push({ start: new Date(s.getTime() - pad * MIN), end: new Date(e.getTime() + pad * MIN) });
      }
      if (blocked) continue;

      const windows = [];
      let free = dayStart;
      for (const iv of mergeIntervals(busy)) {
        if (iv.start > free) windows.push({ start: free, end: new Date(Math.min(iv.start, dayEnd)) });
        if (iv.end > free) free = iv.end;
        if (free >= dayEnd) break;
      }
      if (free < dayEnd) windows.push({ start: free, end: dayEnd });

      const usable = windows
        .map(w => ({ start: ceilTo(w.start, round), end: floorTo(w.end, round) }))
        .filter(w => (w.end - w.start) / MIN >= duration);
      if (usable.length) days.push({ day, windows: usable });
    }
    return days;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  const WEEKDAYS = {
    de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  };
  const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const partsCache = {};
  function partsFormatter(tz) {
    if (!partsCache[tz]) {
      partsCache[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", weekday: "short",
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
      });
    }
    return partsCache[tz];
  }

  /** Wall-clock parts of `date` in IANA time zone `tz`. */
  function zoneParts(date, tz) {
    const out = {};
    for (const p of partsFormatter(tz).formatToParts(date)) {
      if (p.type !== "literal") out[p.type] = p.value;
    }
    return {
      year: Number(out.year), month: Number(out.month), day: Number(out.day),
      weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
      hour: Number(out.hour) % 24, minute: Number(out.minute),
    };
  }

  /** DST-aware abbreviation for a zone key, e.g. CEST, BST, PDT. Falls back to a GMT offset. */
  function zoneAbbr(date, key) {
    const zone = ZONES[key];
    if (!zone) return key;
    for (const locale of [zone.tz.startsWith("America/") ? "en-US" : "en-GB", "en-US"]) {
      try {
        const parts = new Intl.DateTimeFormat(locale, { timeZone: zone.tz, timeZoneName: "short" }).formatToParts(date);
        const name = (parts.find(p => p.type === "timeZoneName") || {}).value || "";
        if (/^[A-Z]{2,5}$/.test(name)) return name;
        if (/^GMT[+-]/.test(name)) return name;
      } catch { /* try next */ }
    }
    return key;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function hm24(p) { return `${pad2(p.hour)}:${pad2(p.minute)}`; }
  function hm12(p) {
    const h = p.hour % 12 || 12;
    return { text: `${h}:${pad2(p.minute)}`, period: p.hour < 12 ? "AM" : "PM" };
  }

  function formatRange(startP, endP, use12h) {
    if (!use12h) return `${hm24(startP)}–${hm24(endP)}`;
    const a = hm12(startP), b = hm12(endP);
    return a.period === b.period ? `${a.text}–${b.text} ${b.period}` : `${a.text} ${a.period}–${b.text} ${b.period}`;
  }

  function formatDay(p, lang, usStyle) {
    if (lang === "de") return `${WEEKDAYS.de[p.weekday]} ${pad2(p.day)}.${pad2(p.month)}.`;
    if (usStyle) return `${WEEKDAYS.en[p.weekday]}, ${MONTHS_EN[p.month - 1]} ${p.day}`;
    return `${WEEKDAYS.en[p.weekday]} ${p.day} ${MONTHS_EN[p.month - 1]}`;
  }

  /**
   * Render the slot list as plain-text lines.
   * @param days      from computeFreeSlots
   * @param lang      "de" | "en"
   * @param zone      key of ZONES, the recipient's time zone (default LOCAL)
   * @param intro     prepend an intro sentence
   * @param alsoHome  append the local range in brackets when zone is not LOCAL
   * @returns {string[]} lines
   */
  function formatSlots(days, { lang = "de", zone = HOME_ZONE, intro = true, alsoHome = false } = {}) {
    const lines = [];
    if (!days.length) {
      lines.push(lang === "de"
        ? "Im gewählten Zeitraum habe ich leider keine freien Zeiten."
        : "Unfortunately I have no free slots in the selected period.");
      return lines;
    }
    const zoneKey = ZONES[zone] ? zone : HOME_ZONE;
    const z = ZONES[zoneKey];
    const isHome = z.tz === ZONES[HOME_ZONE].tz;
    const use12h = lang === "en" && z.tz.startsWith("America/");
    const refDate = days[0].windows[0].start;
    const abbr = zoneAbbr(refDate, zoneKey);
    const label = isHome || zoneKey === HOME_ZONE ? abbr : `${z.name} (${abbr})`;

    if (intro) {
      lines.push(lang === "de"
        ? `Folgende Zeiten würden mir passen (alle Zeiten ${label}):`
        : `The following times would work for me (all times ${label}):`);
      lines.push("");
    }

    const groups = new Map();
    for (const { windows } of days) {
      for (const w of windows) {
        const sp = zoneParts(w.start, z.tz);
        const ep = zoneParts(w.end, z.tz);
        const key = `${sp.year}-${pad2(sp.month)}-${pad2(sp.day)}`;
        if (!groups.has(key)) groups.set(key, { parts: sp, ranges: [] });
        let text = formatRange(sp, ep, use12h);
        if (alsoHome && !isHome) {
          const hs = zoneParts(w.start, ZONES[HOME_ZONE].tz);
          const he = zoneParts(w.end, ZONES[HOME_ZONE].tz);
          text += ` (${formatRange(hs, he, false)} ${zoneAbbr(w.start, HOME_ZONE)})`;
        }
        groups.get(key).ranges.push(text);
      }
    }
    for (const key of [...groups.keys()].sort()) {
      const g = groups.get(key);
      lines.push(`${formatDay(g.parts, lang, use12h)}: ${g.ranges.join(", ")}`);
    }
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Free-text appointment entry
  // ---------------------------------------------------------------------------

  const WEEKDAY_WORDS = [
    ["so", "sonntag", "sun", "sunday"],
    ["mo", "montag", "mon", "monday"],
    ["di", "dienstag", "tue", "tues", "tuesday"],
    ["mi", "mittwoch", "wed", "wednesday"],
    ["do", "donnerstag", "thu", "thur", "thursday"],
    ["fr", "freitag", "fri", "friday"],
    ["sa", "samstag", "sat", "saturday"],
  ];
  const MONTH_WORDS = {
    jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mar: 3, mär: 3, märz: 3, march: 3,
    apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10,
    nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
  };

  /**
   * Parse a free-text date/time in local time. Understands "14.9. 15:00", "14 Sep 15:00",
   * "Sep 14 3pm", "2026-09-14 15:00", "Tue 15:00", "tomorrow 10:30", "15 uhr".
   * @returns {Date|null}
   */
  function parseWhen(input, now = new Date()) {
    let s = String(input || "").toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return null;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let day = null;
    let fromWeekday = false;
    let m;

    const yearOr = (y) => {
      if (!y) return today.getFullYear();
      const n = Number(y);
      return y.length === 2 ? 2000 + n : n;
    };
    const bumpIfPast = (d, hadYear) => {
      if (!hadYear && d.getTime() < today.getTime() - 2 * 86400000) d.setFullYear(d.getFullYear() + 1);
      return d;
    };
    const monthWordRe = "(" + Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join("|") + ")";

    if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) {
      day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})\.(?:(\d{4}|\d{2})(?=\s|$))?/))) {
      day = bumpIfPast(new Date(yearOr(m[3]), Number(m[2]) - 1, Number(m[1])), !!m[3]);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?=\s+\d)/))) {
      day = bumpIfPast(new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[1])), false);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(new RegExp("(?:^|\\s)(\\d{1,2})\\.?\\s*" + monthWordRe + "\\.?(?:\\s+(\\d{4}))?(?=\\s|$)")))) {
      day = bumpIfPast(new Date(yearOr(m[3]), MONTH_WORDS[m[2]] - 1, Number(m[1])), !!m[3]);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(new RegExp("(?:^|\\s)" + monthWordRe + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?(?=\\s|$)")))) {
      day = bumpIfPast(new Date(yearOr(m[3]), MONTH_WORDS[m[1]] - 1, Number(m[2])), !!m[3]);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?=\s|$)/))) {
      // m/d (US) when the first number cannot be a month, else month first
      let mo = Number(m[1]), d = Number(m[2]);
      if (mo > 12) { mo = Number(m[2]); d = Number(m[1]); }
      day = bumpIfPast(new Date(yearOr(m[3]), mo - 1, d), !!m[3]);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(?:^|\s)(heute|today)(?=\s|$)/))) {
      day = new Date(today);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(?:^|\s)(übermorgen|uebermorgen|day after tomorrow)(?=\s|$)/))) {
      day = new Date(today);
      day.setDate(day.getDate() + 2);
      s = s.replace(m[0], " ");
    } else if ((m = s.match(/(?:^|\s)(morgen|tomorrow)(?=\s|$)/))) {
      day = new Date(today);
      day.setDate(day.getDate() + 1);
      s = s.replace(m[0], " ");
    } else {
      for (let dow = 0; dow < 7 && !day; dow++) {
        for (const word of WEEKDAY_WORDS[dow]) {
          const re = new RegExp("(?:^|\\s)(n[äa]chste[nr]?\\s+|next\\s+)?" + word + "\\.?(?=\\s|$)");
          const wm = s.match(re);
          if (wm) {
            day = new Date(today);
            let ahead = (dow - today.getDay() + 7) % 7;
            if (wm[1] && ahead === 0) ahead = 7;
            day.setDate(day.getDate() + ahead);
            fromWeekday = true;
            s = s.replace(wm[0], " ");
            break;
          }
        }
      }
    }

    let hour = null;
    let minute = 0;
    const tm = s.match(/(?:^|\s)(\d{1,2})(?:[:.](\d{2}))?\s*(uhr|h|am|pm|a\.m\.|p\.m\.)?(?=\s|$)/);
    if (tm) {
      hour = Number(tm[1]);
      minute = tm[2] ? Number(tm[2]) : 0;
      const suffix = (tm[3] || "").replace(/\./g, "");
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return null;
      s = s.replace(tm[0], " ");
    }

    if (!day && hour === null) return null;
    if (!day) {
      day = new Date(today);
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (candidate < now) day.setDate(day.getDate() + 1);
    }
    if (hour === null) { hour = 10; minute = 0; }
    const result = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    if (isNaN(result.getTime())) return null;
    if (fromWeekday && result < now) result.setDate(result.getDate() + 7);
    if (s.trim().length > 20) return null;
    return result;
  }

  /** Resolve a named range to [start, endExclusive] Dates. */
  function resolveRange(name, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceMonday = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysSinceMonday);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    switch (name) {
      case "thisWeek": return [today, addDays(monday, 5)];
      case "nextWeek": return [nextMonday, addDays(nextMonday, 5)];
      case "twoWeeks": return [today, addDays(today, 14)];
      case "next5":
      default: return [today, addDays(today, 7)];
    }
  }

  return { computeFreeSlots, formatSlots, resolveRange, parseWhen, isInPerson, blocksWholeDay, zoneAbbr, ZONES, HOME_ZONE, localTz };
});
