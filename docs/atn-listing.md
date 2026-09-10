# addons.thunderbird.net listing

Everything below is ready to paste into the submission form at https://addons.thunderbird.net/developers/addon/submit/distribution

## Basics

- **Name:** Compose Calendar
- **Add-on URL slug:** compose-calendar
- **Summary (max 250 chars):** Free-slot lists and calendar invitations right in the compose window. Paste your availability in the recipient's time zone, or invite everyone in the thread with one click, with a Google Meet link if you use Google Calendar.
- **Categories:** Calendar and Date/Time; Message Composition
- **Tags:** calendar, scheduling, availability, invitation, google meet, time zone, compose
- **Support email:** grossmann@invitris.com (or the GitHub issues page)
- **Homepage:** https://github.com/smisery-prrivate/compose-calendar
- **Support site:** https://github.com/smisery-prrivate/compose-calendar/issues
- **License:** MIT
- **Privacy policy:** The add-on runs entirely inside Thunderbird against the calendars Thunderbird already has. It makes no network requests of its own and collects no data. The only external page it opens, and only when you ask for it, is your web calendar (Google Calendar by default) in a window next to the compose window.

## Description (English)

**One button in every compose window: Calendar.**

**Availability tab.** Computes your free windows from all enabled calendars: working hours you define, 15 min buffer around meetings, 60 min around meetings that need travel (detected from the location), all-day absences block the day, declined and "free" events are ignored. Output in German or English, converted to the recipient's time zone (CET, UK, ET, CT, PT, IST, SGT, JST and more) with DST-correct labels, 12-hour clock for US zones, optionally with your local times in brackets. One click inserts the list at the cursor.

**Invitation tab.** Attendees are prefilled from To/Cc and, when you reply, from everyone who took part in the thread. Type the time as you would say it ("14 Sep 15:00", "Tue 15:00", "tomorrow 10:30") or pick one of your next free slots. Google calendars: the event opens prefilled in Google Calendar's own editor, docked next to your compose window; add Google Meet, save, and Google sends the invitations. CalDAV servers with scheduling support create and send directly. Everything else goes through Thunderbird's event dialog. A sentence about the invitation goes into your email, in the recipient's language and time zone.

**Web calendar beside the compose window.** See your day while you type: the add-on shrinks the compose window and docks your web calendar to its right, optionally for every new message.

Requires Thunderbird 115 or newer with at least one calendar. Uses a small experiment API because Thunderbird's WebExtension APIs cannot read calendar events or add attendees yet; the source is on GitHub.

## Beschreibung (Deutsch)

**Ein Button in jedem Verfassen-Fenster: Kalender.**

**Verfügbarkeit.** Berechnet freie Zeitfenster aus allen aktiven Kalendern: eigene Arbeitszeiten, 15 min Puffer um Termine, 60 min um Termine mit Anfahrt (am Ort erkannt), ganztägige Abwesenheiten blockieren den Tag, abgesagte und "frei"-Termine werden ignoriert. Ausgabe auf Deutsch oder Englisch, umgerechnet in die Zeitzone des Empfängers (CET, UK, ET, CT, PT, IST, SGT, JST und mehr) mit korrekten Sommerzeit-Kürzeln, 12-Stunden-Format für US-Zonen, optional mit den eigenen Zeiten in Klammern. Ein Klick fügt die Liste an der Cursorposition ein.

**Einladung.** Teilnehmer werden aus An/Cc und bei Antworten aus dem gesamten Thread vorausgefüllt. Die Zeit wird eingetippt wie man sie sagt ("14.9. 15:00", "Di 15:00", "morgen 10:30") oder aus den nächsten freien Zeiten gewählt. Google-Kalender: der Termin öffnet sich vorausgefüllt im Google-Calendar-Editor neben dem Verfassen-Fenster; Google Meet hinzufügen, speichern, Google verschickt die Einladungen. CalDAV-Server mit Scheduling legen den Termin direkt an und versenden selbst. Alles andere läuft über den Thunderbird-Termindialog. Ein Satz zur Einladung wird in die E-Mail eingefügt, in Sprache und Zeitzone des Empfängers.

**Web-Kalender neben dem Verfassen-Fenster.** Den eigenen Tag sehen, während man schreibt: das Add-on verkleinert das Verfassen-Fenster und dockt den Web-Kalender rechts daneben an, auf Wunsch bei jeder neuen Nachricht.

Benötigt Thunderbird 115 oder neuer mit mindestens einem Kalender. Nutzt eine kleine Experiment-API, weil die WebExtension-APIs von Thunderbird Kalendertermine noch nicht lesen und keine Teilnehmer setzen können; der Quellcode liegt auf GitHub.

## Version notes for 1.0.0

First public release: availability lists with time-zone conversion, invitations with thread participants and Google Meet, docked web calendar.

## Notes for the reviewer

- The experiment API in `api/api.js` does four things: list events for a date range, list writable calendars, create an event with attendees (or open the standard event dialog prefilled), and collect the participants of a thread by Message-ID. No network access, no preferences written, no data collected.
- `background.js` opens the user's web calendar in a popup window via `windows.create` and resizes the compose window; nothing else.
- The popup uses `tabs.executeScript` on the compose tab only to insert text at the cursor with `document.execCommand`, with `compose.setComposeDetails` as fallback.
- Source zip: `dist/compose-calendar-1.0.0-source.zip`, build with `node scripts/build.cjs`, tests with `node --test test/slots.test.cjs`.

## Screenshots to take (1280×800 or similar)

1. Compose window with the Calendar popup, Invitation tab, thread participants prefilled.
2. Availability tab with the English/PT output.
3. Google Calendar docked next to the compose window.
