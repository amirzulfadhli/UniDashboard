# Database constraint inventory

The Prisma schema plus `prisma/migrations/20260925000000_init/migration.sql` are the physical specification. Every raw SQL object belongs to that migration. This inventory maps invariant → Prisma → PostgreSQL → future service check → integration test in `tests/schema.test.ts`.

| Domain invariant | Prisma representation | PostgreSQL enforcement | Service validation | Test |
| --- | --- | --- | --- | --- |
| 14 persisted entities; no ClassOccurrence | Models and relations only | 14 tables, no occurrence table | Expand virtual occurrences | migration inventory |
| UUIDv7 identities, immutable owner and creation metadata | UUID IDs and `ownerId` | `uuidv7()` defaults; `unios_guard_update` | Authenticated owner is session-derived | provisioning, immutable identity |
| One Profile and Programme per User | Profile owner PK; Programme owner unique | PK, unique, restrictive FK | Provision User/Profile in one transaction | provisioning/uniqueness |
| Same-owner academic/work edges | Simple Prisma relations, owner candidate keys | 15 owner-qualified composite FKs plus schedule predecessor context FK | Scope every read/write to authenticated owner | cross-account references |
| Literal dates, instants, local times | Explicit `@db.Date`, `@db.Timestamptz(3)`, `@db.Time(0)` | Native types; finite date/instant checks; UTC startup option for Prisma connections | Convert date/time carriers at persistence boundary | Prisma/SQL temporal round trips under three timezone defaults |
| Named interpretation timezones | String fields | Nonblank POSIX whitespace checks | Validate IANA zone identifiers | whitespace policy and temporal storage |
| Deadline NONE/DATE_ONLY/TIMED | `DeadlineKind`, nullable payload | `*_deadline_variant_ck` for Task, Assignment, Project | Validate business meaning of deadline | deadline variants |
| Event ALL_DAY/TIMED | `EventTemporalKind`, nullable payload | `event_temporal_variant_ck` | Validate event eligibility | Event variants |
| Task allowed local relationship shapes | Four nullable FKs | `task_assignment_context_ck`, `task_course_context_ck` | Validate Assignment/Project/Course/Term compatibility in locked transaction | Task combinations |
| Project Course, home Term, or neither | Nullable `courseId`, `homeTermId` | `project_context_ck` | Recheck affected Tasks on Project edit | Project context |
| Course Term becomes sticky after first dependant | `firstDependantAt` | `unios_lock_course_context` on six attachment tables; `unios_guard_update` on Course | Recheck edit eligibility inside owner transaction | all six attachment paths and removal |
| Virtual weekly series and sparse exceptions | ClassSchedule, ClassScheduleException; unique original key | Schedule duration/range/retirement checks; exception payload check; unique `(schedule_id, original_date)` | Expand, validate dates, split, prevent cycles | recurrence identity and predecessor tests |
| Predecessor same Course/owner, one successor | Unique predecessor; owner/Course candidate key | Composite predecessor FK; unique index; self check | Validate chain tail and no cycle | predecessor tests |
| Lifecycle terminal evidence retained | Status enums and latest evidence fields | Terminal evidence checks; guard prevents clear/backdate | Validate allowed transitions | lifecycle evidence |
| Archive independent of lifecycle | Separate `archivedAt` columns | Task/Assignment archive eligibility checks | Validate other archive rules and clear selected Term when needed | archive independence |
| Restricted deletion | `onDelete: Restrict`, `onUpdate: Restrict` | Ordinary and owner-qualified FKs | Validate history eligibility; clear only selected Term explicitly | restrictive deletion |
| Nonblank labels and basic Resource URL shape | Required strings | POSIX `[[:space:]]` nonblank checks; `resource_http_url_ck` | Parse URL and validate domain rules | whitespace matrix and catalog verification |

## Whitespace policy

For every field with a database nonblank guarantee, a non-null value must contain at least one character outside PostgreSQL's POSIX `[[:space:]]` class. This rejects empty, space-only, tab-only, newline-only, carriage-return/newline, and mixed whitespace. Nullable fields still accept `NULL`. Validation does not trim or rewrite stored text. Deadline, Event, and moved-exception timezone payload checks use the same rule. Resource URLs have a separate HTTP(S) pattern that excludes all POSIX whitespace.

## Migration preservation rule

The 15 owner-qualified foreign keys, schedule predecessor context FK, CHECK constraints, and trigger definitions are intentionally authored in migration SQL because Prisma cannot represent them all. A Prisma schema diff can propose dropping the 16 supplemental FKs; that diff is **not** permission to remove them. Before applying every future generated migration, review its SQL for removal or alteration of any supplemental FK, CHECK, function, or trigger. Update this inventory and the catalog assertions if an approved change is intentional. `npm test` creates a database from zero and checks exact critical catalog objects, so an accidental drop fails the suite.

Because Task 1 remained under audit and no production database exists, the whitespace fix corrected the initial migration directly. Existing disposable databases made from the earlier draft must be recreated from zero; they are not an upgrade target.

## Trigger responsibilities

`unios_guard_update` fires **BEFORE UPDATE** on all 14 domain tables. It rejects changes to IDs, owner IDs, and creation times; rejects schedule pattern/identity and exception occurrence identity changes; retains and monotonically advances latest `last_*_at` evidence; preserves the Course lock and Term once set; prevents extension of a retired schedule; and sets `updated_at` from `statement_timestamp()`. It does not execute workflow transitions.

`unios_lock_course_context` fires **AFTER INSERT OR UPDATE OF course_id** on Assignment, ClassSchedule, Note, Resource, direct Course Task, and Course-associated Project. It sets `course.first_dependant_at` on the first attachment, in the same transaction. Removal does not unlock the Course. Both triggers are defined and installed in the initial migration.

## Approved service-only rules

The database cannot express every rule as a local row check. Future services must validate cross-record Task compatibility, parent context changes, lifecycle transitions, recurrence split/chain semantics, archive/delete eligibility, IANA timezone identifiers, and account-scoped authorization in the transaction protocol. Direct SQL can bypass these service rules, so runtime database credentials must not be used as a general maintenance interface.

## Dependency advisory disposition

Prisma 7.10 remains pinned. On 25 September 2026, `npm audit` reported four high-severity package entries (`prisma`, `@prisma/config`, `deepmerge-ts`, and `mysql2`); npm listed no safe Prisma 7 fix, and the registry listed 7.10.0 as the newest Prisma 7 release. The `deepmerge-ts` advisory in Prisma CLI configuration handling is temporarily accepted for this Task 1 foundation, where configuration is repository controlled. The `mysql2` authentication and compressed-protocol advisories are not applicable to the selected PostgreSQL runtime. Do not use `npm audit fix --force`, an untested override, Prisma 6 downgrade, or Prisma 8 release candidate as an automatic remedy. Reassess when a tested upstream Prisma 7 fix is available.
