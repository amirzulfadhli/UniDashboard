# Phase 1 Task 4: work management and deadlines

## Baseline and authority

Started at `6e1fda2a12e1e722302f77e380f0268d51352070`, clean and synchronized
with origin/main, after passing the existing gates. Task 1–3 schemas, migrations,
constraints, triggers, identity boundary and recurrence behavior remain unchanged.
The Task 4 clarification authorizes Assignment management and a Deadline domain
API over existing embedded fields. The physical database takes precedence.

## Physical model inventory

All three records have a UUIDv7 primary key, immutable owner/id/created timestamp,
title, optional description, priority LOW/MEDIUM/HIGH/URGENT, status with evidence,
independent archivedAt, updatedAt, and one embedded deadline variant. Services
trim title (1–200 characters) and optional description (up to 2000; whitespace-only
is rejected). No deadline table, independent deadline ID, or destructive record
deletion is introduced. Existing restrictive owner-qualified FKs remain authoritative.

| Record | Parent relationships | Lifecycle | Archive eligibility |
| --- | --- | --- | --- |
| Task | Optional Term, Course, Assignment, Project; combinations below | TODO, IN_PROGRESS, DONE, CANCELLED | DONE or CANCELLED |
| Project | Optional Course or home Term, mutually exclusive | PLANNED, ACTIVE, COMPLETED, CANCELLED | Any existing lifecycle |
| Assignment | Required Course; referenced by Tasks | NOT_STARTED, IN_PROGRESS, READY_TO_SUBMIT, SUBMITTED, GRADED, CANCELLED | SUBMITTED, GRADED, CANCELLED |

Task context CHECKs permit standalone, Term, Course, Assignment, Project,
Term + Project, and Assignment + Project. Direct Course + Project is forbidden by
`task_course_context_ck`; Assignment + Course/Term is forbidden by
`task_assignment_context_ck`. Assignment itself has no Project FK. A Task can
organize Assignment work under a Project. Project's Course/home Term does not
impose equality on its Tasks: a Project may contain work from multiple Courses
and Terms. Project organization does not infer academic provenance for an
otherwise standalone Task. Course-specific Task queries follow direct Course or
Assignment → Course. Project-specific queries return that Project and its Tasks;
they do not synthesize a Project relationship on Assignments.

Assignment and Project have owner/id composite uniqueness supporting FKs. No
title uniqueness is invented. Task context indexes and the three models' existing
owner/status/dueDate and owner/status/dueAt indexes are reused. Direct Task/Project
Course attachment and Assignment creation activate the audited Course dependant
trigger, retaining its firstDependantAt and locking Course Term reassignment.

## Architecture and ownership

`src/work/validation.ts` validates types, IDs, metadata, strict archive values,
deadline variants, literal dates, IANA timezones and instant representations.
`service.ts` implements create/read/edit, lifecycle/archive and the embedded
Deadline API. `queries.ts` owns classification, filtering and snapshot reads.
`src/app/work-actions.ts` obtains ownership through requirePageUser → session →
AuthUser → domain User; browser ownerId/userId/authUserId never control persistence.
Protected `/work` and `/projects` pages use the same boundary. Missing Profile
routes to onboarding. Guessed foreign work/context IDs return NOT_FOUND; malformed
query filters render 404, and action errors redirect with a small domain message.
Database errors are mapped by the existing domain mutation helper, and unexpected
failures receive a generic UI message. No raw database failure is rendered.

## New attachment versus retained relationship

Each mutation acquires the account row lock before reading mutable eligibility.
New/changed academic associations require non-archived Term PLANNED/ACTIVE and
Course UPCOMING/ACTIVE. New Task Project association requires a non-archived
PLANNED/ACTIVE Project. New Task Assignment association requires an incomplete,
non-archived Assignment and eligible Course/Term. Existing unchanged associations
remain editable after their parent becomes historical. Archive/terminal changes
never detach, archive or complete children. Restore re-enables eligibility when
the lifecycle also permits it. Metadata updates replace the explicitly supplied
context set; omitted optional context fields mean an explicit standalone edit,
so callers must submit all contexts they intend to retain (the edit forms do).
Invalid context combinations fail rather than silently dropping a reference.

General active queries depend on the work's own lifecycle and archive state.
They retain incomplete work under archived/terminal contexts. Active Course views
require Course UPCOMING/ACTIVE, Term PLANNED/ACTIVE, neither archived. Active
Project views require Project PLANNED/ACTIVE, non-archived. Management queries can
explicitly include archived records and retain historical parent visibility.

## Deadline API and temporal contract

Deadline target is `(TASK|PROJECT|ASSIGNMENT, owned work ID)`. Intrinsic embedding
prevents orphan deadlines and duplicate deadline rows. CREATE conflicts when a
variant already exists; UPDATE requires an existing variant; REMOVE clears all
payload columns to NONE, idempotently. Each whole variant is written in one SQL
UPDATE inside the account transaction. Creating work plus its deadline is one
transaction. Deadline edits are intrinsic metadata edits, permitted on retained
terminal/archived records; active queries exclude those records. They are not
new parent attachments. No derived classification cache is added.

| Variant | Storage and input | Classification |
| --- | --- | --- |
| NONE | All payload NULL | No temporal category |
| DATE_ONLY | Literal PostgreSQL DATE + mandatory dueTimezone; dueAt NULL | Calendar comparison in stored timezone |
| TIMED | Timestamptz(3) instant + mandatory dueTimezone; dueDate NULL | Actual instant for overdue/upcoming; stored timezone local date for due today |

The schema requires a timezone on *every* non-NONE variant. Therefore its explicit
timezone always wins. Profile timezone prepopulates creation forms; changing
Profile timezone never rewrites or reinterprets stored deadlines. Neither Course
schedule timezone nor process/database/browser timezone is substituted. The
profile fallback described in the clarification does not apply to this schema.
DATE_ONLY does not fabricate UTC midnight or end-of-day as a stored deadline.
Native bound `::date` writes preserve the literal date. Prisma's UTC Date objects
used for DATE query parameters are only the driver's representation of literal
DATE bounds, not deadline instants or classification inputs. All Prisma pools
use the existing UTC startup setting.

TIMED accepts an explicit ISO instant with offset/Z and millisecond precision or
local date/time plus IANA timezone, never both. It reuses audited Temporal helpers:
nonexistent DST times reject; repeated times choose the earlier instant. Editing
a stored timed deadline uses its explicit ISO instant; the timezone controls
calendar display/classification, while changing that timezone alone preserves
the instant. Creation forms offer local date/time.

## Query contract

`queryWork` returns one tagged work record per physical record, without duplicate
deadline entries. ACTIVE uses own incomplete status and non-archived state:
Task TODO/IN_PROGRESS, Project PLANNED/ACTIVE, Assignment NOT_STARTED/IN_PROGRESS/
READY_TO_SUBMIT. SUBMITTED is terminal for active work even before grading.

- TODAY: each deadline's calendar date equals now's calendar date in its stored
  timezone. DUE_ON: equals the caller's requested literal local date in that same
  timezone. No server-local date is used.
- OVERDUE: DATE_ONLY date < current local date; TIMED instant < now. An instant
  exactly at now is not overdue. Completing/archiving work removes it; restoring
  and reopening reintroduces it when its deadline still qualifies.
- UPCOMING requires bounded independent date and instant windows. DATE_ONLY:
  date > local today and within inclusive [startDate,endDate]. TIMED: instant >=
  now, >= start, and < end. Date span and positive instant span are capped at
  366 days. Database candidate predicates bound upcoming retrieval; future work
  is not fetched indefinitely. The UI exposes date boundaries and a next-30-days
  timed window. DATE_ONLY overdue/today/upcoming categories are exclusive; a timed
  deadline earlier today can be both due today and overdue.
- MANAGEMENT includes terminal records and only includes archived when explicitly
  requested. includeArchived accepts true/false (boolean or exact string) only;
  active views reject includeArchived=true.

Ordering is deterministic: deadline's own calendar date label (NONE last), variant,
timed instant, work kind, UUID. This provides a stable mixed representation order
without inventing a date-only instant. Course and Project filters independently
owner-resolve first, including empty contexts; foreign IDs never expose counts.
Supplying both filters intersects them without inferring scope equality.

## Lifecycle evidence and transactions

Services expose exactly the persisted enums and supply the database-required
evidence. They do not add a new state machine. Completion, cancellation, submission,
grading, activation, reopening and reinstatement update appropriate retained
timestamps. Existing evidence is not cleared or moved backward. Task/Assignment
must be restored before moving from archived terminal to incomplete state.
Project archival has no lifecycle restriction in the schema. StatusChangedAt is
updated only on actual transitions; repeated same-state requests are idempotent.

Mutations reuse withOwnerTransaction, account row FOR UPDATE, READ COMMITTED:
owner resolution, parent eligibility, variant/cardinality checks and writes all
occur after serialization. No network work occurs inside these short transactions.
Queries over Tasks, Projects, Assignments and their filter contexts use REPEATABLE
READ for one coherent snapshot. Options are another coherent read snapshot; a
stale form is always revalidated in the authoritative write transaction.

## Verification and limitations

`tests/work.test.ts` covers owner isolation on reads/all mutations/deadline
operations, forged identities, supported/forbidden context combinations, mixed
Courses/Terms, historical visibility, eligibility, retained evidence, strict
archive inputs, variant integrity/reclassification, observed PostgreSQL lock races
and a forced write between the query's model reads. `work-temporal.test.ts` runs
under UTC, Asia/Kuala_Lumpur and America/Los_Angeles process/database settings,
and classifies deadlines in UTC, Kuala Lumpur and New York at fixed instants,
including midnight, local date requests, profile changes, schedule timezone
independence, millisecond boundaries and DST. `smoke-work.ts` exercises the built
authenticated HTTP UI/actions against disposable unios_test only.

No schema, migration or dependency additions. No broad deletion. Existing Task 3
archive parser LOW remains deferred. No Task 5/6, agenda/dashboard, Notes,
Resources, notifications, collaboration, calendar expansion or drag/drop.
Management/active lists have no pagination yet; upcoming queries are bounded.
No browser timezone inference or derived cache. Existing audit findings remain
subject to their previously documented disposition; no force dependency upgrade.
