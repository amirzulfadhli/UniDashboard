# UniOS Phase 1 foundation

Task 1 provides the PostgreSQL 18 / Prisma 7 domain model, migration, database tests, and account mutation transaction helper. Task 2 adds a minimal Next.js application with Better Auth email/password identity, trusted domain owner resolution, and first-time onboarding. Academic features remain out of scope.

## Run the application

Use PostgreSQL 18.6. Copy `.env.example` to `.env`, set `DATABASE_URL`, generate a unique `BETTER_AUTH_SECRET` of at least 32 bytes, and set `BETTER_AUTH_URL` to the app's origin. Apply the migrations before starting the server:

```text
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Visit `/sign-up` to create an account. The first protected request provisions its unique UniOS domain `User`. Complete Profile, optionally add or skip Programme, and create the first Term. The protected `/home` page shows the signed-in identity and selected Term. See [auth architecture](docs/auth-architecture.md) for the mapping, transaction, and owner rules.

## Toolchain

- Node.js 22.12 or later (22.15.0 used here)
- PostgreSQL 18.6 (the migration uses its built-in `uuidv7()`)
- Exact npm versions and transitive dependency lock in `package.json` and `package-lock.json`

Prisma CLI, Client and PostgreSQL adapter are all **7.10.0**. Prisma 7 is the supported stable release as of 25 September 2026; Prisma 8 is a release candidate. TypeScript **5.9.3** is compatible with Prisma 7 and typescript-eslint **8.70.1**. Tests use Node.js's built-in test runner with pinned `tsx` **4.23.15** to load TypeScript. No Next.js shell is needed to validate the database foundation.

## Database setup and gates

Provide `DATABASE_URL` pointing to a disposable PostgreSQL 18 **base database named `unios_test`**. Copy `.env.example` to `.env` and change the connection details, or set the environment variable directly. The test user needs `CREATEDB`. `npm test` creates a uniquely named database, replays the entire migration history, verifies the catalog and behavior, then drops that test database. It never requires a pre-migrated base database.

For a local disposable test instance, run `docker compose -f compose.test.yaml up -d` and use the matching URL in `.env.example`. The Compose service binds only to localhost. Keep production credentials and data separate from this test database.

```text
npm ci
npm run db:format
npm run db:validate
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

The Prisma 7 CLI config is `prisma7.config.ts`, passed explicitly by the database scripts. Migrations are the source of truth; `prisma db push` omits the supplementary constraints and triggers. Generated client code lives in `src/generated/prisma` and is ignored by Git. `npm test` replays the frozen Task 1 migration followed by the additive Task 2 auth migration into a fresh database.

Application code must obtain Prisma through `createPrismaClient`. It sets PostgreSQL's `TimeZone=UTC` as a connection startup option on every pool member; Prisma 7.10's PostgreSQL adapter requires that session setting to preserve `timestamptz` instants. The factory reserves the connection URL's `options` parameter for this setting.

See [constraint inventory](docs/constraint-inventory.md) and [transaction protocol](docs/transaction-protocol.md) before changing the schema.
