# Task 3 academic core

## Baseline and authority

Task 3 began at `636d3abec8a72de6ce569604d02fa66e63108d2d`, clean and equal
to `origin/main`. Before edits, lint, typecheck, Prisma validation/format
comparison, production build, all 33 Task 1/2 tests, clean migration replay,
catalog verification, migration status, and live auth HTTP smoke passed.
Baseline audit reported four high-severity package entries with the previously
accepted advisory dispositions.

Pinned baseline: Next 16.3.6, React 19.3.0, Better Auth and its Prisma adapter
1.7.6, Prisma CLI/client/PG adapter 7.10.0, pg 8.23.0, TypeScript 5.9.3,
tsx 4.23.15, PostgreSQL 18.6. The schema and both migrations remain frozen.

The audited schema/migrations/triggers, transaction documentation, Task 3
specification and user clarifications are the contract. There is no additional
Phase 0 query document. Lifecycle transitions expose existing enum values
and satisfy database evidence checks; no extra transition state machine is
introduced. `last*At` history is retained and never backdated.

## Ownership, validation, errors and transactions

`requireCurrentUser()` resolves session → AuthUser → domain User. Protected
pages use `requirePageUser()`; every academic server action obtains this
trusted owner afresh. Services receive that server-derived context separately
from untrusted input. Inputs are explicit field allowlists; `ownerId`, `userId`,
client predecessor and retirement fields cannot override it. Record and related
record IDs are resolved with owner predicates, including all management reads.

`records.ts` manages Terms/Courses; `schedules.ts` manages immutable recurring
series, exceptions and splits; `queries.ts` retrieves effective classes;
`recurrence.ts` is pure and performs no persistence. `AcademicError` uses
NOT_FOUND, INVALID_INPUT, INVALID_STATE and CONFLICT. Server actions show only
domain messages or a generic unexpected-failure message, never database errors.

All writes use the existing short READ COMMITTED account-row transaction:
lock `app_user`, read related state, validate, write, commit. This includes
preferences, archive/lifecycle changes and exception removal. Course Term
reassignment checks `firstDependantAt` under the same gate; the existing trigger
sets the permanent lock when a schedule is attached. Duplicate Course codes
remain allowed. Reads assembling timetable candidates use a short REPEATABLE
READ snapshot so concurrent splits cannot expose a half-applied chain. Expansion
runs outside that read transaction. No network operations run inside either.

Term parsing reuses onboarding's audited literal-date and IANA validation.
DATE and TIME writes bind literal strings with native SQL casts. Prisma's
UTC-safe DATE/TIME transport carriers are decoded into literal strings; no
date is interpreted as an academic UTC-midnight instant. All clients retain
the existing UTC startup connection path.

## Recurrence and timezones

Identity is `(scheduleId, originalDate)`, where the date is the original local
scheduled date. Weekly generation advances `Temporal.PlainDate` calendar dates
and resolves each date/time in its named zone independently. It never adds
seven UTC days to the first instant. Overnight end times resolve on the next
local calendar day, with the database's positive, at-most-24-hour wall duration.

The pinned `@js-temporal/polyfill` **0.5.1** is the only new direct dependency.
Node 22's Date API cannot convert arbitrary named-zone wall times into instants
with explicit gap/overlap behavior. The standards-oriented polyfill avoids a
custom offset algorithm and stays in domain/server code, outside browser UI
imports. It uses runtime IANA/Intl timezone data. Sources:
[polyfill](https://github.com/js-temporal/temporal-polyfill),
[Temporal ambiguity rules](https://tc39.es/proposal-temporal/docs/timezone.html).

User-approved DST policy: nonexistent start or end clock time means no
occurrence; repeated clock times use the earlier instant. MOVE also rejects
nonexistent wall times. Academic day intervals use successive local start-of-day
instants, permitting 23/25-hour days. A skipped civil day has no active interval.

## Exceptions and effective ranges

Before writing CANCEL/MOVE, the original identity must be a real occurrence:
correct weekday, inclusive original date range, strictly before retirement,
and real local start/end times. The database unique original key remains the
last integrity layer. `putException` explicitly replaces an existing exception;
simultaneous replacements serialize and the last committed replacement wins.
`removeException` restores the original recurrence without changing identity.

CANCEL retains its key and is absent from active results. MOVE retains its key
and replaces start/end instants, timezone and location. Active queries use
half-open interval overlap (`start < queryEnd && end > queryStart`), including
overnight or moved intervals spanning days. A moved-out class is absent at its
original time. A moved-in class is included even if its original date is outside
the query window or its source series is now historical.

Candidate SQL combines original date/range bounds with sparse MOVE interval
overlap. It fetches only relevant exceptions. The original date window includes
two extra days for timezone offsets and overnight overlap. Query expansion is
bounded to a maximum 366-day interval; weekly UI asks for seven days. `nextClass`
seeks the next weekly candidate in each finite eligible series, skipping sparse
exceptions and gap dates, then compares future MOVE candidates. It does not
expand every week between now and the series end or scan original past dates.
Ordering is start instant, end instant, schedule ID, original date. Next means
start at/after now; an already ongoing class remains in today's overlap query.

## Split and retirement

Only the current tail may split. D is validated against original recurrence
before applying exceptions, so CANCEL/MOVE at D does not invalidate its key.
D must be today or later in the source timezone. Successor Course must equal
source Course, preserving the audited composite predecessor relationship.
The new UUID points only to the existing tail; user input cannot choose a
predecessor or manufacture a cycle.

The old series sets `retiredFromDate = D`: D is its first excluded occurrence,
so the prior occurrence is preserved. The successor starts its original range
at D, even when its new weekday first occurs later, and points to the old series.
Old exceptions with original dates **before D** remain. Those **at/after D**
are deleted, never copied or reinterpreted. Retirement, deletion and successor
creation commit or roll back together. Explicit retirement also uses a genuine
future original occurrence boundary and discards exceptions in the removed tail.

## Visibility, preferences and UI

Per user clarification, UPCOMING and ACTIVE Courses appear in active queries
under non-archived Terms in any existing lifecycle state, including PLANNED and
CLOSED. COMPLETED/CANCELLED Courses are excluded. New schedules require UPCOMING
or ACTIVE, non-archived Courses under non-archived Terms. ClassSchedule has no
archive field; none is invented. Historical series remain queryable for retained
occurrences and relevant moved-in exceptions.

Terms/Courses management explicitly includes archived records for restoration.
Archive is independent of lifecycle and never cascades. Archiving a selected
Term clears that preference atomically; restoration does not silently select it.
The user chooses another Term on `/terms`. Default timetable/today/next queries
use the owner's `Profile.selectedTermId`; explicit context IDs remain owner-scoped.

`/terms`, `/courses`, `/timetable` are protected. They expose metadata,
lifecycle/archive/preference forms, immutable recurrence creation, one-occurrence
CANCEL/MOVE/restore, and this-and-future splits. Weekly day grouping uses the
selected Term timezone while each card displays its effective timezone. Overnight
classes appear on each overlapping day. Cancelled cards are in a separate
labelled management section; they never count as active today's/next classes.
The existing home shell links these pages and shows today's and next class.

## Deferred limitations

No occurrence table/cache, arbitrary historical pattern edit, schedule archive
field, drag/drop, full Calendar, notifications or later features. Interval
queries above 366 days must be partitioned by a future caller. Timezone rules
depend on the deployed runtime's maintained IANA data. Conflict detection between
different classes, holidays, attendance and university integrations are outside
Task 3. Existing dependency advisory dispositions and audit LOW findings remain
deferred; no foundation invariant was weakened.
