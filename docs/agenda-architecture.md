# Phase 1 Task 6: unified agenda and timeline

## Purpose and projection

Agenda is a read-only projection over effective Task 3 classes and active Task 4
Task, Assignment and Project deadlines. It creates no table, event cache or
independent deadline. Notes, Resources, parent records, exceptions themselves and
lifecycle/archive events are not agenda items.

`AgendaItem` is a discriminated union of `CLASS` and work deadline kinds. A class
keeps its generated `(scheduleId, originalDate)` identity, effective interval,
effective timezone/location, Course summary, normal/moved state, viewer local
start/end, and derived presentation position. Work items keep their work ID,
kind, title, lifecycle, relevant Course/Project/Assignment summary and either a
DATE_ONLY or TIMED deadline object. The public contract is not a Prisma record.
No persisted ID is fabricated for an occurrence.

## Source and viewer timezones

The authenticated Profile timezone defines viewer today, tomorrow, Monday–Sunday
week, local day boundaries, class overlap and timed-item placement. Task 3 still
resolves recurrence/MOVE in each schedule's effective timezone. Task 4 still uses
the stored deadline timezone to determine a work deadline's local due date,
due-today and overdue status.

A DATE_ONLY deadline remains a literal date and stored timezone. Its agenda
`viewerDate` is that same literal calendar label: an untimed deadline has no
instant from which to calculate a timezone shift. Its `OVERDUE`, `DUE_TODAY` or
`UPCOMING` classification compares that date with *now in the stored deadline
timezone*, using the shared Task 4 helper. It may therefore be classified as due
today while the viewer is still on the preceding calendar date. No 00:00 or
23:59 instant is assigned to it. Prisma's UTC Date objects in bounded SQL DATE
predicates are transport carriers, not business due instants.

A TIMED deadline retains its stored instant. It is grouped by converting that
instant to the Profile timezone; the stored deadline timezone remains available
for source due-today classification. Its `PAST` position means due instant <
injected now; otherwise it is `UPCOMING`. A class is `PAST` if its interval ended,
`CURRENT` if it overlaps now, otherwise `UPCOMING`. These states are computed on
read and never persisted. Only classes are “happening now.” Date-only items never
compete for the next timed item.

## Ranges, grouping and order

Day, Today, Tomorrow, Week and Upcoming all use one projection path and an
explicit injectable `now`. Tomorrow advances a Profile-local calendar date, not
24 elapsed hours. Week is Monday through Sunday in Profile-local dates. Range
dates are inclusive and capped at 366 viewer-local calendar dates. The instant
interval must be positive; DST can make its elapsed duration shorter or longer
than 366 × 24 hours without changing the calendar-date count. This finite date
cap also bounds recurrence expansion. Default Upcoming covers Profile-local today through
30 calendar days later. `/agenda` uses that one bounded snapshot to display
Today and find the next timed item within 30 days.

Classes use half-open effective overlap with each viewer day. An overnight class
appears on both overlapping dates, once on each date; it is never duplicated
within a day. The per-day order is:

1. Classes carried from before that viewer day, by effective start instant.
2. Other classes and timed deadlines by start/due instant.
3. DATE_ONLY deadlines as untimed items.

Equal positions use kind then stable `(scheduleId, originalDate)` or work ID.
`happeningNow` and `nextTimedItem` deduplicate identities across displayed days.
Next is the earliest class start or timed deadline at/after now in the supplied
bounded result; ongoing classes are shown under Now instead of competing by
their past start time.

## Academic and work composition

The agenda calls the Task 3 candidate loader and pure recurrence expansion. That
preserves CANCEL absence, MOVE effective placement, moved-in/out occurrences,
retirement/successor history, overnight intervals, DST policy and existing
Course/Term visibility. The default class context is the Profile's selected
Term. An optional explicit Term is owner-resolved; other Terms are never silently
combined. Archiving the selected Term clears it under existing Task 3 behavior.

Work candidates use bounded bulk queries for the three physical models with the
same active status/archive rules as Task 4. NONE variants and terminal/archived
work do not become agenda items. Active work remains visible in the general
agenda when a historical Course/Term/Project parent later archives or closes.
Task Course context may come directly or through its Assignment; Project is an
independent organizational context. The shared Task 4 deadline helper supplies
source-zone due-today/upcoming/overdue facts.

## Ownership, snapshot and query strategy

The `/agenda` page calls `requirePageUser`, resolving session → AuthUser →
domain User. Service queries accept that trusted owner separately from request
fields and owner-scope every source/filter query. Client owner/user/authUser IDs
cannot broaden the view. A foreign explicit Term returns NOT_FOUND. Anonymous
requests redirect to sign-in. Invalid date/range inputs return a domain-facing
error without database details.

One `REPEATABLE READ` transaction loads Profile, selected/explicit Term,
candidate schedules/exceptions, and bounded active work. Recurrence expansion
and projection run after the transaction over its copied snapshot. A concurrent
account-row mutation cannot produce old classes plus new work in one result.
Task 1–5 mutation locking remains unchanged.

The academic loader bulk-fetches candidate schedules, Courses and relevant
exceptions. Work performs three bounded model reads with relation includes;
Course/Project/Assignment presentation context is loaded in those reads, with no
per-item fetch. No cache is added. SQL DATE and instant predicates narrow work
before in-memory projection. Source functions remain available to the existing
timetable and work pages.

## Performance diagnostic and UI

`tests/agenda.test.ts` seeds one weekly class and six date-only Tasks, constructs
a Prisma client with query-event logging and the same UTC connection startup
setting, and times a seven-day agenda query using `performance.now()`. A local
run on the disposable PostgreSQL container observed **118.7 ms**, **17 SQL
queries**, **one expanded class occurrence** and **seven returned items**. The
elapsed time includes connection and runtime effects and is one diagnostic
sample, not a latency claim or threshold. Repeat with
`node --import tsx --test tests/agenda.test.ts` against disposable `unios_test`;
the test prints fresh values. Query count may change with Prisma internals or
different relation shapes, so compare measurements using the same seed/runtime.

The protected `/agenda` route provides Today, Tomorrow, This Week and bounded
Upcoming views with class, timed and untimed cards, context and presentation
state. It is temporary functional UI. `/home` only gains an Agenda link. The
final dashboard, widgets, drag/drop, notifications, caching and performance
refactors remain outside Task 6.
