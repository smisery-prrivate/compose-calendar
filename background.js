/* global browser */
"use strict";

// ---------------------------------------------------------------------------
// Web calendar window docked to the right of a compose window
// ---------------------------------------------------------------------------

const CALENDAR_WIDTH = 560;
const DEFAULT_CALENDAR_URL = "https://calendar.google.com/calendar/u/0/r/day/{y}/{m}/{d}";
const calendarWindows = new Map(); // composeWindowId -> calendar window id

function fillDate(template, date) {
  const d = date instanceof Date ? date : new Date();
  return template
    .replace(/\{y\}/g, String(d.getFullYear()))
    .replace(/\{m\}/g, String(d.getMonth() + 1))
    .replace(/\{d\}/g, String(d.getDate()));
}

async function calendarUrl(date) {
  let template = DEFAULT_CALENDAR_URL;
  try {
    const { settings } = await browser.storage.local.get("settings");
    if (settings && settings.calendarUrl && /^https?:\/\//.test(settings.calendarUrl)) template = settings.calendarUrl;
  } catch { /* defaults */ }
  return fillDate(template, date);
}

/**
 * Open (or focus) the web calendar docked to the right of a compose window.
 * Shrinks the compose window so both are visible side by side.
 */
async function openCalendarBeside(composeWindowId, date, url) {
  const existing = calendarWindows.get(composeWindowId);
  if (existing) {
    try {
      if (url) {
        const [tab] = await browser.tabs.query({ windowId: existing });
        if (tab) await browser.tabs.update(tab.id, { url });
      }
      await browser.windows.update(existing, { focused: true });
      return existing;
    } catch {
      calendarWindows.delete(composeWindowId);
    }
  }
  const compose = await browser.windows.get(composeWindowId);
  const total = compose.width;
  const composeWidth = Math.max(640, total - CALENDAR_WIDTH);
  const calWidth = Math.max(420, total - composeWidth);
  if (compose.state === "maximized" || compose.state === "fullscreen") {
    await browser.windows.update(composeWindowId, { state: "normal" });
  }
  await browser.windows.update(composeWindowId, { left: compose.left, top: compose.top, width: composeWidth, height: compose.height });
  const calWin = await browser.windows.create({
    url: url || await calendarUrl(date),
    type: "popup",
    left: compose.left + composeWidth,
    top: compose.top,
    width: calWidth,
    height: compose.height,
  });
  calendarWindows.set(composeWindowId, calWin.id);
  return calWin.id;
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === "openCalendarBeside") {
    const date = msg.date ? new Date(msg.date) : new Date();
    return openCalendarBeside(msg.windowId, date, msg.url || null);
  }
  return undefined;
});

// Close the calendar window together with its compose window
browser.windows.onRemoved.addListener(async (windowId) => {
  const calId = calendarWindows.get(windowId);
  if (calId) {
    calendarWindows.delete(windowId);
    try { await browser.windows.remove(calId); } catch { /* already closed */ }
  }
  for (const [composeId, cId] of calendarWindows) {
    if (cId === windowId) calendarWindows.delete(composeId);
  }
});

// Optional: open the calendar automatically for every new compose window
browser.windows.onCreated.addListener(async (win) => {
  if (win.type !== "messageCompose") return;
  try {
    const { settings } = await browser.storage.local.get("settings");
    if (!settings || !settings.autoCalendar) return;
    setTimeout(() => openCalendarBeside(win.id, new Date()).catch(e => console.warn("auto calendar failed", e)), 800);
  } catch (e) {
    console.warn("settings unavailable", e);
  }
});
