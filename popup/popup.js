/* global browser, ComposeCalendarSlots, t */
"use strict";

const S = ComposeCalendarSlots;
const $ = (id) => document.getElementById(id);
const els = {
  duration: $("duration"), range: $("range"),
  lang: $("lang"), tz: $("tz"), alsoHome: $("alsoHome"),
  inPerson: $("inPerson"), intro: $("intro"), calendars: $("calendars"),
  preview: $("preview"), status: $("status"),
  workStart: $("workStart"), workEnd: $("workEnd"),
  buffer: $("buffer"), commute: $("commute"), lead: $("lead"),
  refresh: $("refresh"), insert: $("insert"),
  ivTitle: $("ivTitle"), ivAttendees: $("ivAttendees"), ivAttendeeHint: $("ivAttendeeHint"),
  ivWhen: $("ivWhen"), ivWhenHint: $("ivWhenHint"),
  ivDuration: $("ivDuration"), ivSlot: $("ivSlot"), ivCalendar: $("ivCalendar"), ivOrganizer: $("ivOrganizer"),
  ivMeet: $("ivMeet"), ivLocation: $("ivLocation"), ivMyLinkBtn: $("ivMyLinkBtn"), ivDescription: $("ivDescription"),
  ivAddMe: $("ivAddMe"), ivNote: $("ivNote"), ivReview: $("ivReview"), ivStatus: $("ivStatus"),
  ivMyLink: $("ivMyLink"), calendarUrl: $("calendarUrl"), autoCalendar: $("autoCalendar"),
  ivOpenCal: $("ivOpenCal"), ivSend: $("ivSend"),
};

const uiLang = (() => {
  try { return browser.i18n.getUILanguage().toLowerCase().startsWith("de") ? "de" : "en"; } catch { return "en"; }
})();

const DEFAULTS = {
  duration: "30", range: "next5", lang: uiLang, tz: "LOCAL", alsoHome: false, intro: true,
  workStart: "08:00", workEnd: "18:00", buffer: 15, commute: 60, lead: 60,
  disabledCalendars: [],
  ivCalendar: "", ivDuration: "30", ivMyLink: "", ivNote: true, ivAddMe: false, ivReview: false,
  calendarUrl: "", autoCalendar: false,
  tab: "invite",
};

let settings = { ...DEFAULTS };
let calendars = [];
let inviteCalendars = [];
let composeTab = null;
let composeDetails = null;
let identity = null;
let ownEmails = new Set();
let whenTouched = false;

function setStatus(el, msg, cls) {
  el.textContent = msg || "";
  el.className = "status" + (cls ? " " + cls : "");
}

function withTimeout(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(t("errorTimeout", [what, String(Math.round(ms / 1000))]))), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// Settings + segmented toggles
// ---------------------------------------------------------------------------

function segValue(seg) {
  const active = seg.querySelector("button.active");
  return active ? active.dataset.value : null;
}
function setSeg(seg, value) {
  for (const b of seg.querySelectorAll("button")) b.classList.toggle("active", b.dataset.value === value);
}
function wireSeg(seg, onChange) {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setSeg(seg, b.dataset.value);
    onChange();
  });
}

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get("settings");
    settings = { ...DEFAULTS, ...(stored.settings || {}) };
  } catch { /* defaults */ }
  els.duration.value = settings.duration;
  els.range.value = settings.range;
  setSeg(els.lang, settings.lang);
  setSeg(els.tz, S.ZONES[settings.tz] ? settings.tz : DEFAULTS.tz);
  els.alsoHome.checked = settings.alsoHome;
  els.intro.checked = settings.intro;
  els.workStart.value = settings.workStart;
  els.workEnd.value = settings.workEnd;
  els.buffer.value = settings.buffer;
  els.commute.value = settings.commute;
  els.lead.value = settings.lead;
  els.ivDuration.value = settings.ivDuration;
  els.ivMyLink.value = settings.ivMyLink;
  els.ivNote.checked = settings.ivNote;
  els.ivAddMe.checked = settings.ivAddMe;
  els.ivReview.checked = settings.ivReview;
  els.calendarUrl.value = settings.calendarUrl;
  els.autoCalendar.checked = settings.autoCalendar;
  // Show the local zone's abbreviation on the toggle
  const localBtn = els.tz.querySelector('button[data-value="LOCAL"]');
  if (localBtn) {
    const abbr = S.zoneAbbr(new Date(), "LOCAL");
    if (abbr && abbr !== "LOCAL") localBtn.textContent = abbr;
  }
}

async function saveSettings(extra = {}) {
  settings = {
    ...settings,
    duration: els.duration.value,
    range: els.range.value,
    lang: segValue(els.lang) || DEFAULTS.lang,
    tz: segValue(els.tz) || DEFAULTS.tz,
    alsoHome: els.alsoHome.checked,
    intro: els.intro.checked,
    workStart: els.workStart.value,
    workEnd: els.workEnd.value,
    buffer: Number(els.buffer.value),
    commute: Number(els.commute.value),
    lead: Number(els.lead.value),
    disabledCalendars: calendars.filter(c => !c.checkbox.checked).map(c => c.id),
    ivCalendar: els.ivCalendar.value || settings.ivCalendar,
    ivDuration: els.ivDuration.value,
    ivMyLink: els.ivMyLink.value.trim(),
    ivNote: els.ivNote.checked,
    ivAddMe: els.ivAddMe.checked,
    ivReview: els.ivReview.checked,
    calendarUrl: els.calendarUrl.value.trim(),
    autoCalendar: els.autoCalendar.checked,
    ...extra,
  };
  try { await browser.storage.local.set({ settings }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

let availLoaded = false;

function showTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.tab === name);
  $("tab-avail").hidden = name !== "avail";
  $("tab-invite").hidden = name !== "invite";
  saveSettings({ tab: name });
  if (name === "invite") initInvite();
  if (name === "avail" && !availLoaded) { availLoaded = true; refresh(); }
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) showTab(b.dataset.tab);
});

// ---------------------------------------------------------------------------
// Compose window helpers
// ---------------------------------------------------------------------------

async function getComposeTab() {
  if (composeTab) return composeTab;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error(t("errorNoCompose"));
  composeTab = tab;
  return tab;
}

async function getComposeDetails() {
  if (composeDetails) return composeDetails;
  const tab = await getComposeTab();
  composeDetails = await browser.compose.getComposeDetails(tab.id);
  try { identity = await browser.identities.get(composeDetails.identityId); } catch { identity = null; }
  try {
    for (const id of await browser.identities.list()) if (id.email) ownEmails.add(id.email.toLowerCase());
  } catch { /* ignore */ }
  return composeDetails;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function linkify(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

async function insertIntoBody(text) {
  const tab = await getComposeTab();
  const details = await browser.compose.getComposeDetails(tab.id);
  const html = linkify(escapeHtml(text)).replace(/\n/g, "<br>");
  let inserted = false;
  try {
    const code = details.isPlainText
      ? `document.execCommand("insertText", false, ${JSON.stringify(text + "\n")});`
      : `document.execCommand("insertHTML", false, ${JSON.stringify(html + "<br>")});`;
    const [ok] = await browser.tabs.executeScript(tab.id, { code });
    inserted = ok !== false;
  } catch (e) {
    console.warn("executeScript failed, appending to body instead:", e);
  }
  if (!inserted) {
    if (details.isPlainText) {
      await browser.compose.setComposeDetails(tab.id, { plainTextBody: (details.plainTextBody || "") + "\n" + text + "\n" });
    } else {
      await browser.compose.setComposeDetails(tab.id, { body: (details.body || "") + "<p>" + html + "</p>" });
    }
  }
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function renderCalendars(list) {
  els.calendars.textContent = "";
  calendars = list.map(c => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !settings.disabledCalendars.includes(c.id);
    cb.addEventListener("change", refresh);
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = c.color || "#999";
    label.append(cb, swatch, document.createTextNode(c.name));
    els.calendars.appendChild(label);
    return { id: c.id, name: c.name, checkbox: cb };
  });
}

let cache = { key: null, events: [], calendars: [] };

async function fetchEvents(rangeStart, rangeEnd) {
  const key = rangeStart.toISOString() + "|" + rangeEnd.toISOString();
  if (cache.key === key) return cache;
  const res = await withTimeout(browser.composeCalendar.getBusyEvents(rangeStart.toISOString(), rangeEnd.toISOString()), 30000, t("whatCalendar"));
  if (res.error) throw new Error(res.error);
  cache = { key, events: res.events, calendars: res.calendars };
  if (!calendars.length) renderCalendars(res.calendars);
  return cache;
}

function slotOptions() {
  return {
    workStart: settings.workStart, workEnd: settings.workEnd,
    bufferMin: settings.buffer, commuteBufferMin: settings.commute,
    leadMin: settings.lead, roundMin: 15,
  };
}

async function refresh() {
  await saveSettings();
  setStatus(els.status, t("statusLoading"));
  els.insert.disabled = true;
  try {
    const now = new Date();
    const [rangeStart, rangeEnd] = S.resolveRange(settings.range, now);
    const { events } = await fetchEvents(rangeStart, rangeEnd);
    const enabled = new Set(calendars.filter(c => c.checkbox.checked).map(c => c.id));
    const days = S.computeFreeSlots(events, {
      ...slotOptions(), rangeStart, rangeEnd, now,
      durationMin: Number(settings.duration),
      inPersonNew: els.inPerson.checked,
      calendarIds: calendars.length ? enabled : null,
    });
    const lines = S.formatSlots(days, { lang: settings.lang, zone: settings.tz, intro: settings.intro, alsoHome: settings.alsoHome });
    els.preview.value = lines.join("\n");
    const count = days.reduce((n, d) => n + d.windows.length, 0);
    setStatus(els.status, t("statusFreeWindows", [String(count), String(days.length), String(events.length)]));
    els.insert.disabled = days.length === 0;
  } catch (e) {
    setStatus(els.status, t("errorPrefix", [e.message || String(e)]), "error");
  }
}

async function insert() {
  const text = els.preview.value.trim();
  if (!text) return;
  setStatus(els.status, t("statusInserting"));
  try {
    await insertIntoBody(text);
    window.close();
  } catch (e) {
    setStatus(els.status, t("errorInsert", [e.message || String(e)]), "error");
  }
}

// ---------------------------------------------------------------------------
// Invitation
// ---------------------------------------------------------------------------

function parseAddress(s) {
  const m = String(s).match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || "").trim(), email: m[2].trim() };
  return { name: "", email: String(s).trim() };
}
function parseAttendees(text) {
  return text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(parseAddress).filter(a => /@/.test(a.email));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function timeValue(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function whenValue(d) {
  return settings.lang === "de"
    ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${timeValue(d)}`
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${timeValue(d)}`;
}
function cleanSubject(s) {
  return String(s || "").replace(/^\s*((re|aw|fw|fwd|wg|antw|sv|vs)\s*:\s*)+/i, "").trim();
}
function mergePeople(target, list) {
  for (const p of list) {
    const email = (p.email || "").toLowerCase();
    if (!email || ownEmails.has(email)) continue;
    const existing = target.get(email);
    if (!existing) target.set(email, { email: p.email, name: p.name || "" });
    else if (!existing.name && p.name) existing.name = p.name;
  }
}

let inviteInitialised = false;

async function initInvite() {
  if (inviteInitialised) return;
  inviteInitialised = true;
  setStatus(els.ivStatus, t("statusLoading"));
  try {
    const details = await withTimeout(getComposeDetails(), 15000, t("whatCalendar"));

    const people = new Map();
    mergePeople(people, [...(details.to || []), ...(details.cc || [])].map(parseAddress).filter(a => /@/.test(a.email)));
    let threadInfo = "";
    if (details.relatedMessageId) {
      try {
        const msg = await browser.messages.get(details.relatedMessageId);
        const res = await withTimeout(browser.composeCalendar.getThreadParticipants({
          headerMessageId: msg.headerMessageId,
          accountId: msg.folder ? msg.folder.accountId : null,
          path: msg.folder ? msg.folder.path : null,
        }), 15000, t("whatCalendar"));
        if (res && !res.error && res.found) {
          mergePeople(people, res.participants);
          threadInfo = t("threadInfo", [String(res.participants.length), String(res.messages)]);
        }
        if (!details.subject && msg.subject) els.ivTitle.value = cleanSubject(msg.subject);
      } catch (e) {
        console.warn("thread participants unavailable", e);
      }
    }
    const list = [...people.values()];
    els.ivAttendees.value = list.map(a => a.email).join(", ");
    els.ivAttendeeHint.textContent = threadInfo;
    if (!els.ivTitle.value) els.ivTitle.value = cleanSubject(details.subject) || t("defaultTitle");

    // Default time right away so the form is usable immediately
    if (!els.ivWhen.value.trim()) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      els.ivWhen.value = whenValue(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0));
      updateWhenHint();
    }

    const cals = await withTimeout(browser.composeCalendar.getInviteCalendars(), 20000, t("whatCalendarList"));
    if (cals.error) throw new Error(cals.error);
    inviteCalendars = cals;
    els.ivCalendar.textContent = "";
    for (const c of cals) {
      const opt = document.createElement("option");
      opt.value = c.id;
      const acct = c.username || c.ownerEmail;
      opt.textContent = acct && acct !== c.name ? `${c.name} (${acct})` : c.name;
      els.ivCalendar.appendChild(opt);
    }
    const preferred = cals.find(c => c.id === settings.ivCalendar) || cals.find(c => c.google && c.ownerEmail) || cals.find(c => c.autoSchedule) || cals[0];
    if (preferred) els.ivCalendar.value = preferred.id;
    updateOrganizerHint();
    setStatus(els.ivStatus, "");

    withTimeout(fillSlotSelect(), 30000, t("whatCalendar"))
      .then(() => {
        if (!whenTouched && els.ivSlot.options.length > 1) {
          els.ivSlot.selectedIndex = 1;
          applySlot();
        }
      })
      .catch(e => setStatus(els.ivStatus, t("freeSlotsNotLoaded", [e.message || String(e)]), "error"));
  } catch (e) {
    setStatus(els.ivStatus, t("errorPrefix", [e.message || String(e)]), "error");
  }
}

function selectedCalendar() {
  return inviteCalendars.find(c => c.id === els.ivCalendar.value) || null;
}
function organizerFor(cal) {
  if (!cal) return null;
  return cal.username || cal.ownerEmail || cal.organizerId || (identity && identity.email) || null;
}
function updateOrganizerHint() {
  const cal = selectedCalendar();
  if (!cal) { els.ivOrganizer.textContent = ""; return; }
  const org = organizerFor(cal) || "";
  els.ivMeet.disabled = !cal.google;
  els.ivMeet.checked = cal.google; // Meet is the default for Google calendars
  if (cal.google) els.ivOrganizer.textContent = t("hintGoogleSends", [org]);
  else if (cal.autoSchedule) els.ivOrganizer.textContent = t("hintServerSends", [org]);
  else els.ivOrganizer.textContent = t("hintThunderbirdSends", [org]);
}

async function fillSlotSelect() {
  const now = new Date();
  const [rangeStart, rangeEnd] = S.resolveRange("twoWeeks", now);
  const { events } = await fetchEvents(rangeStart, rangeEnd);
  const days = S.computeFreeSlots(events, {
    ...slotOptions(), rangeStart, rangeEnd, now,
    durationMin: Number(els.ivDuration.value), inPersonNew: false, calendarIds: null,
  });
  const keep = els.ivSlot.value;
  els.ivSlot.textContent = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = t("chooseSuggestion");
  els.ivSlot.appendChild(first);
  let n = 0;
  for (const { windows } of days) {
    for (const w of windows) {
      if (n++ >= 40) break;
      const opt = document.createElement("option");
      opt.value = w.start.toISOString();
      opt.textContent = S.formatSlots([{ day: w.start, windows: [w] }], { lang: settings.lang, intro: false })[0];
      els.ivSlot.appendChild(opt);
    }
  }
  if (keep) els.ivSlot.value = keep;
}

function applySlot() {
  if (!els.ivSlot.value) return;
  els.ivWhen.value = whenValue(new Date(els.ivSlot.value));
  updateWhenHint();
}
function parsedStart() {
  return S.parseWhen(els.ivWhen.value, new Date());
}
function updateWhenHint() {
  const start = parsedStart();
  if (!start) {
    els.ivWhenHint.textContent = els.ivWhen.value.trim() ? t("whenNotUnderstood") : t("whenEmpty");
    els.ivWhenHint.className = "hint error";
    els.ivSend.disabled = true;
    return;
  }
  const end = new Date(start.getTime() + Number(els.ivDuration.value) * 60000);
  const line = S.formatSlots([{ day: start, windows: [{ start, end }] }], { lang: settings.lang, intro: false })[0];
  const abbr = S.zoneAbbr(start, "LOCAL");
  const past = start < new Date();
  els.ivWhenHint.textContent = `${line} ${abbr} ${start.getFullYear()}${past ? " " + t("whenPast") : ""}`;
  els.ivWhenHint.className = "hint " + (past ? "error" : "ok");
  els.ivSend.disabled = false;
}
function inviteTimes() {
  const start = parsedStart();
  if (!start) throw new Error(t("errorWhen"));
  const end = new Date(start.getTime() + Number(els.ivDuration.value) * 60000);
  return { start, end };
}

function noteLine(start, end, meetInInvite) {
  const line = S.formatSlots([{ day: start, windows: [{ start, end }] }], {
    lang: settings.lang, zone: settings.tz, intro: false, alsoHome: settings.alsoHome,
  })[0];
  const abbr = S.zoneAbbr(start, S.ZONES[settings.tz] ? settings.tz : "LOCAL");
  let text = settings.lang === "de"
    ? `Ich habe dir gerade eine Kalendereinladung geschickt: ${line} ${abbr}.`
    : `I have just sent you a calendar invitation: ${line} ${abbr}.`;
  if (meetInInvite) {
    text += settings.lang === "de" ? " Der Google-Meet-Link steht in der Einladung." : " The Google Meet link is in the invitation.";
  }
  return text;
}

function collectInvite() {
  const { start, end } = inviteTimes();
  const title = els.ivTitle.value.trim();
  if (!title) throw new Error(t("errorNoTitle"));
  const attendees = parseAttendees(els.ivAttendees.value);
  if (els.ivAddMe.checked && identity && identity.email && !attendees.some(a => a.email.toLowerCase() === identity.email.toLowerCase())) {
    attendees.push({ email: identity.email, name: identity.name || "" });
  }
  return { start, end, title, attendees, location: els.ivLocation.value.trim(), description: els.ivDescription.value.trim() };
}

function googleStamp(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
/** Google Calendar's event editor, prefilled with everything except the Meet link. */
function googleEditorUrl(inv) {
  const params = new URLSearchParams({ text: inv.title, dates: `${googleStamp(inv.start)}/${googleStamp(inv.end)}` });
  if (inv.location) params.set("location", inv.location);
  if (inv.description) params.set("details", inv.description);
  if (inv.attendees.length) params.set("add", inv.attendees.map(a => a.email).join(","));
  return "https://calendar.google.com/calendar/u/0/r/eventedit?" + params.toString();
}

async function sendInvite() {
  await saveSettings();
  els.ivSend.disabled = true;
  setStatus(els.ivStatus, t("statusCreating"));
  try {
    const inv = collectInvite();
    if (!inv.attendees.length) throw new Error(t("errorNoAttendees"));
    const cal = selectedCalendar();
    if (!cal) throw new Error(t("errorNoCalendar"));

    if (els.ivMeet.checked && cal.google) {
      const tab = await getComposeTab();
      await browser.runtime.sendMessage({ type: "openCalendarBeside", windowId: tab.windowId, date: inv.start.toISOString(), url: googleEditorUrl(inv) });
      if (els.ivNote.checked) await insertIntoBody(noteLine(inv.start, inv.end, true));
      setStatus(els.ivStatus, t("statusGoogleOpened"), "ok");
      setTimeout(() => window.close(), 1500);
      return;
    }

    // Servers with auto-scheduling (e.g. Google CalDAV) send the invitation themselves.
    // Everything else goes through Thunderbird's event dialog, which sends on save.
    const openDialog = els.ivReview.checked || !cal.autoSchedule;
    const res = await browser.composeCalendar.createInvite({
      calendarId: cal.id,
      title: inv.title,
      start: inv.start.toISOString(),
      end: inv.end.toISOString(),
      location: inv.location,
      description: inv.description,
      attendees: inv.attendees,
      organizerEmail: organizerFor(cal),
      organizerName: identity ? identity.name : "",
      openDialog,
    });
    if (res.error) throw new Error(res.error);
    if (els.ivNote.checked) await insertIntoBody(noteLine(inv.start, inv.end, false));
    setStatus(els.ivStatus, res.dialog ? t("statusDialogOpened") : t("statusCreated", [res.calendarName]), "ok");
    cache.key = null;
    setTimeout(() => window.close(), 900);
  } catch (e) {
    setStatus(els.ivStatus, t("errorPrefix", [e.message || String(e)]), "error");
    els.ivSend.disabled = false;
  }
}

async function openCalendarBeside() {
  await saveSettings();
  try {
    const tab = await getComposeTab();
    let date = null;
    try { date = inviteTimes().start.toISOString(); } catch { date = null; }
    await browser.runtime.sendMessage({ type: "openCalendarBeside", windowId: tab.windowId, date });
    window.close();
  } catch (e) {
    setStatus(els.ivStatus, t("errorPrefix", [e.message || String(e)]), "error");
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const id of ["duration", "range", "alsoHome", "inPerson", "intro", "workStart", "workEnd", "buffer", "commute", "lead"]) {
  els[id].addEventListener("change", refresh);
}
wireSeg(els.lang, refresh);
wireSeg(els.tz, refresh);
els.refresh.addEventListener("click", () => { cache.key = null; refresh(); });
els.insert.addEventListener("click", insert);

els.ivSlot.addEventListener("change", applySlot);
els.ivWhen.addEventListener("input", () => { whenTouched = true; updateWhenHint(); });
els.ivDuration.addEventListener("change", () => { saveSettings(); fillSlotSelect().catch(() => {}); updateWhenHint(); });
els.ivCalendar.addEventListener("change", () => { saveSettings(); updateOrganizerHint(); });
els.ivMyLinkBtn.addEventListener("click", () => {
  const link = els.ivMyLink.value.trim();
  if (!link) { setStatus(els.ivStatus, t("errorMyLink"), "error"); return; }
  els.ivLocation.value = link;
  els.ivMeet.checked = false;
});
for (const id of ["ivMyLink", "ivNote", "ivAddMe", "ivReview", "ivMeet", "calendarUrl", "autoCalendar"]) {
  els[id].addEventListener("change", () => saveSettings());
}
els.ivSend.addEventListener("click", sendInvite);
els.ivOpenCal.addEventListener("click", openCalendarBeside);

loadSettings().then(() => showTab(settings.tab === "avail" ? "avail" : "invite"));
