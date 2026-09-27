import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createPrismaClient } from "../src/db/client.js";
import { AuthIdentityMissingError, provisionDomainUser } from "../src/auth/provision.js";

const prisma = createPrismaClient();
after(async () => prisma.$disconnect());

function identityData() {
  const id = randomUUID();
  return { id, name: "Student", email: `${id}@example.test`, emailVerified: false };
}

test("concurrent and repeated provisioning converge on one domain User", async () => {
  const identity = await prisma.authUser.create({ data: identityData() });
  const users = await Promise.all(Array.from({ length: 8 }, () => provisionDomainUser(prisma, identity.id)));
  assert.equal(new Set(users.map((user) => user.id)).size, 1);
  assert.equal((await provisionDomainUser(prisma, identity.id)).id, users[0]!.id);
  assert.equal((await prisma.authUser.findUniqueOrThrow({ where: { id: identity.id } })).domainUserId, users[0]!.id);
  assert.equal(await prisma.authUser.count({ where: { domainUserId: users[0]!.id } }), 1);
});

test("database enforces unique mapping and rejects cross-identity remapping", async () => {
  const identityA = await prisma.authUser.create({ data: identityData() });
  const identityB = await prisma.authUser.create({ data: identityData() });
  const ownerA = await provisionDomainUser(prisma, identityA.id);
  const ownerB = await provisionDomainUser(prisma, identityB.id);
  assert.notEqual(ownerA.id, ownerB.id);

  await assert.rejects(
    prisma.authUser.update({ where: { id: identityB.id }, data: { domainUserId: ownerA.id } }),
    (error: unknown) => (error as { code?: string }).code === "P2002",
  );
  assert.equal((await provisionDomainUser(prisma, identityB.id)).id, ownerB.id);
  await assert.rejects(provisionDomainUser(prisma, "missing-auth-id"), AuthIdentityMissingError);
});

test("auth identity cannot cascade-delete a mapped domain User", async () => {
  const identity = await prisma.authUser.create({ data: identityData() });
  const owner = await provisionDomainUser(prisma, identity.id);
  await assert.rejects(
    prisma.user.delete({ where: { id: owner.id } }),
    (error: unknown) => (error as { code?: string }).code === "P2003",
  );
  const foreignKey = await prisma.$queryRaw<Array<{ delete_action: string }>>`
    SELECT confdeltype::text AS delete_action
    FROM pg_constraint WHERE conname = 'AuthUser_domainUserId_fkey'
  `;
  assert.equal(foreignKey[0]?.delete_action, "r");
});

test("sign-up, server session, provisioning, and sign-out", async () => {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "0123456789abcdef0123456789abcdef";
  const { auth } = await import("../src/auth/server.js");
  const authRoute = await import("../src/app/api/auth/[...all]/route.js");
  assert.equal((await authRoute.POST(new Request("http://localhost:3000/api/auth/delete-user", { method: "POST" }))).status, 404);
  assert.equal((await authRoute.POST(new Request("http://localhost:3000/api/auth/update-user", { method: "POST" }))).status, 404);
  assert.equal((await authRoute.GET(new Request("http://localhost:3000/api/auth/sign-up/email"))).status, 405);
  const email = `${randomUUID()}@example.test`;
  const signUp = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ name: "Student", email, password: "Task2-test-password-123!" }),
  }));
  assert.equal(signUp.status, 200, await signUp.text());
  const cookie = signUp.headers.getSetCookie().find((item) => item.includes("session_token="))?.split(";")[0];
  assert.ok(cookie, "signup issues a session cookie");

  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session?.user.email, email);
  const owner = await provisionDomainUser(prisma, session!.user.id);
  assert.equal((await provisionDomainUser(prisma, session!.user.id)).id, owner.id);
  assert.equal((await prisma.authUser.findUniqueOrThrow({ where: { id: session!.user.id } })).domainUserId, owner.id);

  const deniedDeletion = await auth.handler(new Request("http://localhost:3000/api/auth/delete-user", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000" },
  }));
  assert.ok(deniedDeletion.status >= 400);
  assert.equal((await prisma.authUser.findUniqueOrThrow({ where: { id: session!.user.id } })).domainUserId, owner.id);

  const signOut = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000" },
  }));
  assert.equal(signOut.status, 200, await signOut.text());
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
});
