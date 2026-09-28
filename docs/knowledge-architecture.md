# Phase 1 Task 5: Notes and Resources

## Baseline and physical model audit

Started at `992a617f3aced868d7b81447a7802cf32686c663`, clean and equal to
origin/main, with phase1-task1 through phase1-task4 tags. Before implementation,
all 65 existing test executions, clean migration replay/status/catalog, Prisma
format comparison/validate, lint, typecheck, production build and all existing
authenticated HTTP smoke suites passed. npm audit retained four high entries
with their existing dispositions. No schema, migration or dependency change.

| Field / relationship | Note | Resource |
| --- | --- | --- |
| Identity | UUIDv7 id, immutable ownerId and createdAt | Same |
| Required label | title TEXT, database nonblank check; no uniqueness | Same |
| Content | contentMarkdown TEXT, default empty string; pinned boolean default false | url TEXT required; optional description TEXT |
| Context | Nullable Course, owner-qualified restrictive FK | Same |
| Direct Term/Project/Task/Assignment | Absent | Absent |
| Lifecycle/evidence | Absent | Absent |
| Archive | Nullable archivedAt, no lifecycle prerequisite | Same |
| Metadata | createdAt/updatedAt TIMESTAMPTZ(3); audited update guard | Same |
| Indexes | Course/owner; owner/archive/updatedAt DESC/id | Owner; Course/owner |

## Compatibility matrix (established before services)

| Context | Note | Resource |
| --- | --- | --- |
| Standalone | Allowed | Allowed |
| One direct Course | Allowed | Allowed |
| Direct Term, Project, Task or Assignment | Unsupported | Unsupported |
| Multiple contexts | Unsupported | Unsupported |

Course's Term is used only to validate Course eligibility/visibility. No direct
Term filter or inferred Project scope is invented. Unsupported nonempty context
fields are rejected. Duplicate titles and URLs remain valid. Existing restrictive
FKs protect ownership/deletion; no destructive delete service is exposed.
Note/Resource attachment activates the existing Course first-dependant trigger:
Course Term locks permanently even if knowledge is later detached or archived.

## Architecture, ownership and errors

Knowledge services receive a separately trusted owner derived by server actions
and protected pages from session → AuthUser → domain User. Untrusted ownerId,
userId, authUserId and creation identity fields cannot change ownership. Every
record/context read uses id plus owner. Missing and foreign IDs share NOT_FOUND.
The existing small AcademicError approach is reused, including INVALID_INPUT,
INVALID_STATE and CONFLICT; unexpected failures get generic action messages.

The domain lives in `src/knowledge`: validation, service, queries and simple safe
presentation components. `/notes` and `/resources` are protected list/read/edit
interfaces with creation, context choice/filter and archive/restore. Dedicated
read links also resolve requested record IDs through ownership. No rich editor,
Markdown renderer, search, URL metadata retrieval or upload architecture.

## Attachment eligibility and visibility

New/changed Course attachment requires owner-valid, non-archived Course
UPCOMING/ACTIVE and Term PLANNED/ACTIVE, non-archived, matching audited Task 4.
Unchanged historical Course associations remain editable when Course/Term later
archives or becomes terminal. Omitted courseId on update retains the association;
explicit null/empty detaches it. No validation silently drops an invalid context.

General active knowledge follows only the knowledge record's archive status,
so historical parent changes never hide retained Notes/Resources. Active Course
filters also require eligible Course and Term. MANAGEMENT can explicitly include
archived records and inactive Course context, always owner-scoped. Restoring
parents restores context-specific visibility; no child state/content is changed.

An omitted query courseId lists all personal knowledge; explicit null filters
standalone records. The UI exposes this as "Standalone only".

Archive accepts only boolean true/false or exact strings "true"/"false".
It changes archivedAt alone, preserving Course, content, URL and pinned metadata.
No lifecycle is invented. Ordering is updatedAt descending then UUID ascending,
including management/history lists. Pinned is editable metadata, not ranking.

## Content and size contract

contentMarkdown is a source string, not an AST. Empty and whitespace-only content,
Unicode, tabs, line breaks, Markdown-looking and HTML-looking text are preserved
exactly. Omitted content on metadata edits is retained; explicit empty content
clears it. PostgreSQL cannot store null characters, so they produce INVALID_INPUT.
The Note editor has separate metadata/context and content forms. The metadata
action rejects a submitted contentMarkdown field, and its service update omits
that database column entirely. The content action deliberately writes the exact
string received from form submission, including the browser's textarea line-ending
normalization when it occurs. It does not normalize or trim the submitted string.
Textarea editing and React preformatted text render it without parsing
HTML/Markdown. There is no arbitrary body truncation or small editor maxLength.
The schema has no content-size limit; Next's existing Server Action body-size
limit bounds HTTP requests. Trusted internal service callers must bound bulk
payloads themselves; no migration or new global request limit is introduced.
Titles use the existing application convention of trimmed nonblank text up to
200 characters. Resource optional descriptions use the existing 2000-character
validation convention. These are service limits, not claimed database limits.

## URL security and rendering

The database's resource_http_url_ck permits case-insensitive HTTP/HTTPS shape
without whitespace. Services additionally parse absolute URLs, reject credentials,
relative/protocol-relative URLs, controls, whitespace, backslashes, malformed
authority/percent escapes and unsupported schemes. Valid input is stored without
silent URL rewriting. HTTP remains supported by the audited database, including
development hosts. Neither creation/edit nor rendering fetches a URL server-side.

Links use framework escaping, target="_blank" and rel="noopener noreferrer".
Rendering validates again: an invalid legacy/direct-SQL URL is displayed as text
with no clickable link. User-controlled titles, descriptions and Note content are
React text nodes; no dangerouslySetInnerHTML. HTML-like content stays data.

## Transactions, concurrency and snapshots

Every write locks the authenticated account row in the existing short READ
COMMITTED transaction before reading mutable parent eligibility. Validation and
all context/content/URL/metadata writes commit or roll back together. No external
network operation runs inside a transaction. Simultaneous edits use last serialized
write semantics, without collaboration/versioning. New attachment versus parent
archive/terminal transition serializes; an accepted earlier relationship survives,
while a later new attachment rejects.

Queries resolving Course/Term state and knowledge records use REPEATABLE READ.
Owner-scoped Course options use a separate coherent snapshot and may be stale by
submission; mutation eligibility is authoritative under the account gate.

## Verification and deferred limitations

Integration tests cover ownership on every operation, forging/unsupported contexts,
content preservation and size, duplicate labels, URL validation, archive/history,
eligibility, deterministic real-lock races, rollback, permanent Course locking and
forced snapshot interleaving. Rendered tests verify text escaping and safe links.
Production HTTP smoke exercises real forms/actions and their security boundaries.

General and history lists have no pagination yet. The database only enforces basic
URL shape; the service and rendering boundary enforce the stronger safe-link rule.
No URLs are fetched, so reachability is not verified. Markdown source is displayed
as text. Existing dependency advisories and Task 3 parser LOW remain deferred.
No Task 6 or later features, schema/migrations or dependencies are introduced.
