# Compose Calendar for Thunderbird

Free-slot lists and calendar invitations right in the compose window. Think of the scheduling helpers in Superhuman or Gmail, but for Thunderbird and your own calendars.

One button, **Calendar**, in the toolbar of every compose window:

**Invitation tab**
- Attendees prefilled from To/Cc **and everyone who took part in the thread** when you reply.
- Type the time as you would say it: `14.9. 15:00`, `14 Sep 15:00`, `Tue 15:00`, `tomorrow 10:30`, `2026-09-14 15:00`. A line underneath confirms what was understood.
- Or pick one of your next free slots from a dropdown.
- Google calendars: the invitation is created with a **Google Meet** link in Google Calendar's own editor, which opens docked next to your compose window (two clicks: "Add Google Meet", Save). Google sends the invitations.
- Other CalDAV calendars with server-side scheduling: the event is created directly and the server sends the invitations.
- Everything else: Thunderbird's event dialog opens prefilled, and saving it sends the invitations.
- A sentence about the invitation is inserted into the email, in the recipient's language and time zone.

**Availability tab**
- Computes your free windows from all enabled calendars: working hours, 15 min buffer around meetings, 60 min around meetings that need travel (detected from the location), all-day absences block the day, declined and "free" events are ignored.
- Output in German or English, converted to the recipient's time zone (CET, UK, ET, CT, PT, IST, SGT, JST, …) with DST-correct labels, 12-hour clock for US zones, optional local time in brackets.
- Inserted at the cursor with one click.

**Web calendar beside the compose window**
- "Open calendar beside" shrinks the compose window and opens your web calendar (Google Calendar by default, any URL configurable) docked to its right, so you can see your day while you type. Optionally automatic for every new message.

## If this saves you time, cure a disease with it

This add-on is free. If it earns you back an hour, please put a few euros toward FOP research instead. FOP (fibrodysplasia ossificans progressiva) is an ultra-rare disease that slowly turns muscle into bone. It is personal to me. Donations go to the IFOPA's 2026 In Pursuit of a Cure campaign:

**https://ifopa.salsalabs.org/2026InPursuitofaCureWebsite/index.html**

## Privacy

Everything runs inside Thunderbird against the calendars Thunderbird already has. The add-on makes no network requests of its own. The only external page it opens, and only when you ask for it, is your web calendar (Google Calendar by default) in a window next to the compose window.

## Install

- From [addons.thunderbird.net](https://addons.thunderbird.net/) once published, or
- download the `.xpi` from the [releases](https://github.com/smisery-prrivate/compose-calendar/releases) and install it via Add-ons Manager → gear icon → *Install Add-on From File…*

Requires Thunderbird 115 or newer with calendars set up (CalDAV, Google via CalDAV, local).

## Build from source

```bash
node scripts/make-icons.cjs
node --test test/slots.test.cjs
node scripts/build.cjs
```

The build writes `dist/compose-calendar-<version>.xpi` and a source zip for reviewers. The slot engine (`popup/slots.js`) is plain JavaScript with unit tests; the experiment API (`api/api.js`) only reads calendars, creates events and looks up thread participants.

## Why an experiment API?

Thunderbird's WebExtension APIs cannot read calendar events or add attendees to events yet. The small experiment in `api/` uses Thunderbird's internal calendar modules for exactly those four operations and nothing else.

## License

MIT, see [LICENSE](LICENSE). Built by Patrick Grossmann with a lot of help from Claude.
