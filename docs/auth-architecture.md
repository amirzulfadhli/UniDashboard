# Task 2 identity boundary

UniOS uses Better Auth 1.7.6 for email and password registration, sign-in,
sign-out, and server-side sessions. Its Prisma adapter receives the shared
`getPrisma()` client. That client is constructed by Task 1's
`createPrismaClient()`, which adds PostgreSQL's `TimeZone=UTC` startup option to
every physical connection. No second database pool is created for auth.

## Storage and identifiers

Better Auth stores credentials and sessions in `AuthUser`, `AuthSession`,
`AuthAccount`, and `AuthVerification`. Their columns and relations follow schema
output from the pinned `auth@1.7.6 generate` CLI. Better Auth generates string
IDs for these infrastructure rows. The existing `app_user` and every academic
record retain Task 1's UUIDv7 domain identifiers.

`AuthUser.domainUserId` is a unique nullable foreign key to `app_user.id` with
`ON DELETE RESTRICT`. It is nullable only between creation of the auth identity
and first trusted provisioning. A transaction creates the domain `User` and
sets the link atomically, so an interrupted transaction commits neither step.
The unique index prevents two auth identities from mapping to one domain user;
the single column on each auth row prevents one identity from mapping to two.
Existing unlinked domain users from Task 1 remain valid. No auth table owns
academic records, and deleting an auth row cannot cascade into them. Account
deletion is not exposed in Task 2.

## Trusted owner context

Protected pages and server actions call `requireCurrentUser()` from
`src/auth/current-user.ts`. It validates the session server-side, obtains the
Better Auth identity ID, and resolves or provisions the mapped **domain**
`User`. Missing sessions throw `UnauthenticatedError`; a deleted or missing
auth identity and database failures reject protected access. The function
returns the domain user record, whose `id` is the only allowed `ownerId` in
future domain services. A request body, URL, form, or client state must never
select the owner or change the auth/domain mapping.

Provisioning locks the `AuthUser` row with `SELECT ... FOR UPDATE`, checks the
existing mapping, then creates and links a domain `User` in one Prisma
transaction. Concurrent calls serialize on the same auth row and return the
same domain user. Sign-up may commit the auth identity before the first
protected request; that request provisions the domain user. A failed
provisioning attempt leaves the identity unlinked and access fails until a
later retry succeeds.

## Routes and onboarding

`/sign-in` and `/sign-up` are public. The API route allows only Better Auth's
GET `/get-session` and POST `/sign-up/email`, `/sign-in/email`, `/sign-out`
under `/api/auth`; other auth paths return 404. Protected pages and actions use the trusted helper and
redirect or reject missing sessions. The application shell is available only
after authoritative domain data shows a `Profile`, at least one `Term`, and a
selected Term belonging to the same owner. Programme is optional. This rule
does not rely on a mutable completion flag.

The Profile and first Term service boundaries validate IANA timezones. Date
only fields are parsed as literal calendar dates, with ordering checked before
database writes. Onboarding mutations use the domain user ID from
`requireCurrentUser()`, lock that account row, and set the selected Term only
when it belongs to the same owner. See `src/onboarding` for the service rules.

## Configuration

Set `DATABASE_URL`, a unique cryptographically random `BETTER_AUTH_SECRET`
(at least 32 characters), and `BETTER_AUTH_URL` to the application's canonical
HTTP or HTTPS origin. `src/auth/config.ts` validates both auth settings before
the Better Auth instance or Prisma singleton is constructed. Missing, blank,
short, or known public placeholder secrets fail in development and production.
The canonical URL must be absolute, with no credentials, non-root path, query,
or fragment. A trailing slash is normalized; local HTTP remains supported.
Validated `secret` and `baseURL` are passed explicitly to Better Auth. Errors
name the invalid setting without including its value.
The alternate `BETTER_AUTH_SECRETS` rotation setting is unsupported and rejected
when nonblank, preventing the pinned library from overriding the validated secret.

Generate a private secret locally using
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Store the production secret in the deployment's secret manager; the
value in `.env.example` is a placeholder and must never be deployed. Apply migrations
before serving requests. Email delivery and email verification are outside
the Task 2 scope; production deployment should define the verification policy
before admitting users.
