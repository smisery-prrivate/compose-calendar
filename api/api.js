/* global ExtensionCommon, ChromeUtils, Services, Cc, Ci */
"use strict";

/**
 * Compose Calendar experiment API.
 * Reads Thunderbird's calendars and creates events; nothing leaves the machine.
 */
var composeCalendar = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

    function loadCal() {
      try {
        return ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs").cal;
      } catch {
        return null;
      }
    }

    function toISO(dt) {
      if (!dt) return null;
      try { return new Date(dt.nativeTime / 1000).toISOString(); } catch { return null; }
    }

    function ownAddresses() {
      const own = new Set();
      try {
        for (const identity of MailServices.accounts.allIdentities) {
          if (identity.email) own.add(identity.email.toLowerCase());
        }
      } catch { /* no identities */ }
      return own;
    }

    return {
      composeCalendar: {
        getBusyEvents: async function(startDate, endDate) {
          const cal = loadCal();
          if (!cal) return { error: "Calendar not available" };
          const startJs = new Date(startDate);
          const endJs = new Date(endDate);
          if (isNaN(startJs.getTime()) || isNaN(endJs.getTime()) || endJs <= startJs) {
            return { error: "Invalid date range" };
          }
          const own = ownAddresses();
          const FILTER_EVENT = 1 << 3;
          const FILTER_OCCURRENCES = 1 << 4;
          const rangeStart = cal.dtz.jsDateToDateTime(startJs, cal.dtz.defaultTimezone);
          const rangeEnd = cal.dtz.jsDateToDateTime(endJs, cal.dtz.defaultTimezone);

          const calendars = [];
          const events = [];
          for (const calendar of cal.manager.getCalendars()) {
            if (calendar.getProperty("disabled")) continue;
            if (calendar.getProperty("capabilities.events.supported") === false) continue;
            calendars.push({ id: calendar.id, name: calendar.name, color: calendar.getProperty("color") || null });
            const owners = new Set(own);
            const organizerId = calendar.getProperty("organizerId");
            if (organizerId) owners.add(organizerId.replace(/^mailto:/i, "").toLowerCase());

            let items = [];
            try {
              items = await calendar.getItemsAsArray(FILTER_EVENT | FILTER_OCCURRENCES, 0, rangeStart, rangeEnd);
            } catch {
              continue;
            }
            for (const item of items) {
              let declined = false;
              try {
                for (const attendee of item.getAttendees()) {
                  const addr = (attendee.id || "").replace(/^mailto:/i, "").toLowerCase();
                  if (owners.has(addr) && attendee.participationStatus === "DECLINED") { declined = true; break; }
                }
              } catch { /* no attendee info */ }
              let transparent = false;
              let cancelled = false;
              try {
                transparent = (item.getProperty("TRANSP") || "").toUpperCase() === "TRANSPARENT";
                cancelled = (item.getProperty("STATUS") || "").toUpperCase() === "CANCELLED";
              } catch { /* keep defaults */ }
              events.push({
                calendarId: calendar.id,
                title: item.title || "",
                start: toISO(item.startDate),
                end: toISO(item.endDate),
                allDay: !!(item.startDate && item.startDate.isDate),
                location: item.getProperty("LOCATION") || "",
                transparent,
                cancelled,
                declined,
              });
            }
          }
          events.sort((a, b) => new Date(a.start) - new Date(b.start));
          return { calendars, events };
        },

        getInviteCalendars: async function() {
          const cal = loadCal();
          if (!cal) return { error: "Calendar not available" };
          try {
            const out = [];
            for (const c of cal.manager.getCalendars()) {
              if (c.getProperty("disabled") || c.readOnly) continue;
              if (c.getProperty("capabilities.events.supported") === false) continue;
              if (!["caldav", "gdata", "storage", "ics"].includes(c.type)) continue;
              const spec = c.uri ? c.uri.spec : "";
              const google = /apidata\.googleusercontent\.com|googleapis\.com/i.test(spec);
              // Google CalDAV: /caldav/v2/<account or calendar id>/events/. Only a mailbox address can act as organizer.
              let ownerEmail = null;
              try {
                const m = decodeURIComponent(spec).match(/\/caldav\/v2\/([^/]+)\//);
                if (m && /@/.test(m[1]) && !/\.calendar\.google\.com$|@virtual$/i.test(m[1])) ownerEmail = m[1];
              } catch { /* ignore */ }
              let organizerId = null;
              try { organizerId = (c.getProperty("organizerId") || "").replace(/^mailto:/, "") || null; } catch { /* ignore */ }
              let username = null;
              try { username = c.getProperty("username") || null; } catch { /* ignore */ }
              out.push({
                id: c.id,
                name: c.name,
                type: c.type,
                color: c.getProperty("color") || null,
                google,
                ownerEmail,
                organizerId,
                username: google ? (username || ownerEmail) : null,
                autoSchedule: c.getProperty("capabilities.autoschedule.supported") === true,
              });
            }
            return out;
          } catch (e) {
            return { error: e.toString() };
          }
        },

        createInvite: async function(params) {
          const p = params || {};
          const cal = loadCal();
          let CalEvent, CalAttendee;
          try {
            CalEvent = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs").CalEvent;
            CalAttendee = ChromeUtils.importESModule("resource:///modules/CalAttendee.sys.mjs").CalAttendee;
          } catch (e) {
            return { error: "Calendar module not available: " + e };
          }
          if (!cal) return { error: "Calendar not available" };
          try {
            const calendar = cal.manager.getCalendars().find(c => c.id === p.calendarId);
            if (!calendar) return { error: "Calendar not found" };
            if (calendar.readOnly) return { error: `Calendar is read-only: ${calendar.name}` };
            const startJs = new Date(p.start);
            const endJs = new Date(p.end);
            if (isNaN(startJs.getTime()) || isNaN(endJs.getTime()) || endJs <= startJs) return { error: "Invalid start/end" };
            if (!p.title) return { error: "Title required" };
            const attendees = Array.isArray(p.attendees) ? p.attendees.filter(a => a && a.email) : [];
            if (!attendees.length && !p.openDialog) return { error: "No attendees" };

            const event = new CalEvent();
            event.title = p.title;
            event.startDate = cal.dtz.jsDateToDateTime(startJs, cal.dtz.defaultTimezone);
            event.endDate = cal.dtz.jsDateToDateTime(endJs, cal.dtz.defaultTimezone);
            if (p.location) event.setProperty("LOCATION", p.location);
            if (p.description) event.setProperty("DESCRIPTION", p.description);
            event.calendar = calendar;

            const organizerEmail = (p.organizerEmail || "").trim();
            if (organizerEmail) {
              const org = new CalAttendee();
              org.id = "mailto:" + organizerEmail;
              if (p.organizerName) org.commonName = p.organizerName;
              org.isOrganizer = true;
              org.role = "CHAIR";
              org.participationStatus = "ACCEPTED";
              event.organizer = org;
            }
            for (const a of attendees) {
              const att = new CalAttendee();
              att.id = "mailto:" + String(a.email).trim();
              if (a.name) att.commonName = a.name;
              att.role = "REQ-PARTICIPANT";
              att.participationStatus = "NEEDS-ACTION";
              att.rsvp = "TRUE";
              event.addAttendee(att);
            }
            event.setProperty("X-MOZ-SEND-INVITATIONS", "TRUE");

            if (p.openDialog) {
              const win = Services.wm.getMostRecentWindow("mail:3pane") || Services.wm.getMostRecentWindow(null);
              if (!win) return { error: "No Thunderbird window found" };
              const args = {
                calendarEvent: event,
                calendar,
                mode: "new",
                inTab: false,
                onOk(item, target) { target.addItem(item); },
              };
              win.openDialog(
                "chrome://calendar/content/calendar-event-dialog.xhtml",
                "_blank",
                "centerscreen,chrome,titlebar,toolbar,resizable",
                args
              );
              return { success: true, dialog: true, calendarName: calendar.name };
            }
            const added = await calendar.addItem(event);
            return {
              success: true,
              eventId: (added && added.id) || event.id || null,
              calendarName: calendar.name,
              organizer: organizerEmail || null,
              attendees: attendees.map(a => a.email),
            };
          } catch (e) {
            return { error: e.toString() };
          }
        },

        getThreadParticipants: async function(params) {
          const p = params || {};
          const mid = String(p.headerMessageId || "").replace(/^<|>$/g, "").trim();
          if (!mid) return { error: "headerMessageId required" };
          try {
            const own = ownAddresses();
            const lookup = (folder) => {
              try {
                const db = folder.msgDatabase;
                return db ? db.getMsgHdrForMessageID(mid) : null;
              } catch {
                return null;
              }
            };
            let hdr = null;
            if (p.accountId && typeof p.path === "string") {
              try {
                const account = MailServices.accounts.getAccount(p.accountId);
                let folder = account && account.incomingServer.rootFolder;
                for (const seg of p.path.split("/").filter(Boolean)) {
                  if (!folder) break;
                  const subs = folder.subFolders;
                  folder = (Array.isArray(subs) ? subs : Array.from(subs || [])).find(f => f.name === seg) || null;
                }
                if (folder) hdr = lookup(folder);
              } catch { /* fall through */ }
            }
            if (!hdr) {
              let checked = 0;
              for (const folder of MailServices.accounts.allFolders) {
                if (checked++ > 400) break;
                hdr = lookup(folder);
                if (hdr) break;
              }
            }
            if (!hdr) return { found: false, participants: [] };

            const people = new Map();
            const add = (value) => {
              if (!value) return;
              let parsed = [];
              try { parsed = MailServices.headerParser.parseDecodedHeader(value); } catch { return; }
              for (const a of parsed) {
                const email = (a.email || "").toLowerCase();
                if (!email || !email.includes("@") || own.has(email)) continue;
                if (/noreply|no-reply|mailer-daemon|notifications?@|calendar-notification/i.test(email)) continue;
                const entry = people.get(email);
                if (!entry) people.set(email, { email: a.email, name: a.name || "" });
                else if (!entry.name && a.name) entry.name = a.name;
              }
            };
            const addHdr = (h) => {
              add(h.mime2DecodedAuthor || h.author);
              add(h.mime2DecodedRecipients || h.recipients);
              add(h.ccList);
            };
            let thread = null;
            try { thread = hdr.folder.msgDatabase.getThreadContainingMsgHdr(hdr); } catch { thread = null; }
            let messages = 0;
            if (thread) {
              for (let i = 0; i < thread.numChildren; i++) {
                try { addHdr(thread.getChildHdrAt(i)); messages++; } catch { /* skip */ }
              }
            } else {
              addHdr(hdr);
              messages = 1;
            }
            return { found: true, messages, participants: [...people.values()] };
          } catch (e) {
            return { error: e.toString() };
          }
        },
      },
    };
  }
};
