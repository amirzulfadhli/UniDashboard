# Task 7: dashboard foundation

`/home` is the protected overview. It resolves the session to a domain owner,
then calls `getDashboard` with one captured `now`. Missing setup redirects to
onboarding; an absent or archived selected term redirects to term selection.
Request-supplied owner IDs and term filters never enter dashboard queries.

## Composition and consistency

One repeatable-read transaction composes the existing onboarding state, Agenda
and Work rules, current courses, and signed-in identity. Agenda and Work expose
transaction-scoped loaders; their existing public service wrappers still open
their own repeatable-read transactions. Pure Agenda expansion and dashboard
projection run after the snapshot transaction closes. There is no dashboard recurrence engine,
deadline storage, lifecycle logic, cache, or mutation endpoint.

Agenda supplies today's effective classes, overnight overlaps, MOVE/CANCEL,
current classes, and the next class within a bounded 30-calendar-day lookahead.
Profile timezone defines viewer dates and displayed times. Class identity stays
`(scheduleId, originalDate)`; multi-day occurrences deduplicate for the next class.
Classes and current courses follow selected-term and existing archive rules.

Work supplies all active, unarchived Tasks, Projects and Assignments. General
work remains visible when its historical academic context closes or archives.
The shared `deadlineFacts` helper classifies overdue and due-today in each stored
deadline timezone. DATE_ONLY remains a literal date, labelled All day with its
stored timezone. TIMED retains its instant and displays in Profile timezone;
different source date/timezone remains visible. At the due instant it is not
overdue. Due-today and overdue counters can overlap for timed work.

## Ranking and bounds

The deadline panel includes overdue work, source-zone due-today work, and future
deadlines through viewer today + 30 calendar days. Overdue appears first, then
due today, then upcoming; dates, timed instants, kind and ID stabilize ordering.
Timed entries on the same viewer date compare their full instants, including
seconds and milliseconds, so a repeated DST hour cannot reverse their order.
Mixed date-only and timed entries use calendar labels, without assigning an
instant to all-day work. Six deadlines display, with a total and link to Work.

Tasks rank overdue, due today, then other work; within each group they rank
URGENT, HIGH, MEDIUM, LOW, then in-progress, deadline labels and stable ID. Five
display, including tasks without deadlines. Today shows up to six classes and
links to the complete agenda. Four current courses display with a total.
Teaching week is calendar arithmetic from teaching start in academic timezone,
within teaching dates; it does not infer lifecycle state or semester progress.

The query count is independent of card count: bulk model reads, no per-item
relation fetches. Dashboard work reads select only identity, title, lifecycle,
priority and deadline fields; they omit descriptions and relation payloads.
Classification and ranking run after the snapshot transaction closes. The
dashboard loads Agenda class candidates without loading work a second time.
Exact counts still read all active work, so memory/processing grows with active
workspace size. The visual shortlists are bounded, not database pagination.

## Interface and verification

The server-rendered overview has responsive navigation, keyboard focus and skip
link, labelled sections, helpful empty states, and explicit page-load freshness.
It has no fake analytics, completion controls, or live-clock claims. New task
opens the existing creation form; cards link to anchored existing work records.
Sign-out remains the existing authenticated client flow. Styling is scoped to
the dashboard; other feature screens keep their current presentation.
Long unbroken greeting names wrap within the heading's available width. Error
recovery uses a normal `/home` navigation to fetch a fresh authenticated server
render, including when the failed server payload remains in the client router.

`npm test` includes dashboard composition, ownership, lifecycle, timezone/DST,
interleaved snapshot, query scaling and server-rendered escaping checks.
`scripts/smoke-dashboard.ts` exercises production authentication/setup gates,
empty and populated states, owner isolation, task links and refresh behavior.
It runs only against disposable `unios_test`, and is included in the production
HTTP verifier alongside the five earlier suites. Volume regressions cover 5,000
timed Tasks with long descriptions plus 500 Project/Assignment deadlines in the
service, and a 5,000-task production HTTP page. Browser recovery checks should
induce a read failure in disposable `unios_test`, restore the database, and use
Try again; responsive checks use a maximum-length 120-character unbroken display
name at 320px, 375px and desktop widths. Reusable assertions live in
`tests/browser/dashboard-regressions.mjs`; import them in `cua_repl` and pass its
authenticated Tab and viewport capability. `checkDashboardContents` verifies
volume/counts and the exact timed/all-day panel orders, `checkDashboardLayout`
checks real document and greeting overflow, and `checkDashboardError` plus
`retryDashboard` verify failure/retry before and after restoring the database.
