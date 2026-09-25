# V1 mutation transaction protocol

Every future application mutation must:

1. Derive `ownerId` from the authenticated session at the service boundary.
2. Begin a short PostgreSQL `READ COMMITTED` transaction.
3. Lock that account's `app_user` row with `SELECT ... FOR UPDATE` before reading mutable domain state.
4. Validate the complete proposed change and any affected related records.
5. Perform all writes through the same transaction and commit.

`src/db/owner-transaction.ts` implements steps 2–3 and passes the transaction client to a callback for steps 4–5. Its test proves the Prisma 7 PostgreSQL adapter can acquire the row lock and commit. It does not authenticate callers or implement future domain mutations.

All mutations, including nested, bulk, preference, and deletion operations, must follow the same account gate. Never make external network calls while holding it. A transient database failure should retry the whole transaction with fresh validation, using a bounded retry policy in a future service. Direct maintenance SQL requires the same coordination or controlled exclusive maintenance.

Cross-record validations left for services include Task/Project/Assignment context compatibility; parent context edits and their existing Tasks; lifecycle transition eligibility; archive/deletion eligibility; recurrence cycle prevention, split semantics, and exception date eligibility; and IANA timezone validation. These are intentionally outside the two focused database triggers.
