import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { completeFirstTerm, saveProfile } from "../src/onboarding/service";

const { baseURL, secret } = loadAuthConfiguration();
const email = `${randomUUID()}@example.test`;
const credentials = { name: "Smoke student", email, password: "Smoke-test-password-123!" };
const prisma = getPrisma();
function get(path: string, cookie = "") {
  return fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" });
}
function post(path: string, body: object, cookie = "", origin = baseURL) {
  return fetch(`${baseURL}/api/auth/${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body), redirect: "manual",
  });
}

try {
  for (const path of ["/home", "/onboarding"]) {
    const response = await get(path);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/sign-in");
  }
  const signup = await post("sign-up/email", credentials);
  assert.equal(signup.status, 200);
  const cookieHeader = signup.headers.getSetCookie().find((value) => value.includes("session_token="));
  assert.ok(cookieHeader);
  const cookie = cookieHeader.split(";")[0]!;
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.equal(/;\s*Secure(?:;|$)/i.test(cookieHeader), baseURL.startsWith("https:"));
  const sessionResponse = await get("/api/auth/get-session", cookie);
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json() as { user: { id: string; email: string } };
  assert.equal(session.user.email, email);
  const onboarding = await get("/onboarding", cookie);
  assert.equal(onboarding.status, 200);
  assert.ok(!(await onboarding.text()).includes(secret));
  const beforeSetup = await get("/home", cookie);
  assert.equal(beforeSetup.headers.get("location"), "/onboarding");

  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const actionId = Object.entries(manifest.node).find(([, value]) => value.exportedName === "skipProgrammeAction")?.[0];
  assert.ok(actionId);
  async function action(origin: string) {
    return fetch(`${baseURL}/onboarding`, {
      method: "POST", headers: { origin, cookie, "Next-Action": actionId!, "content-type": "text/plain" }, body: "[]", redirect: "manual",
    });
  }
  const validAction = await action(baseURL);
  assert.ok(validAction.status < 400);
  assert.match(validAction.headers.get("x-action-redirect") ?? "", /step=term/);
  const rejectedAction = await action("https://attacker.example");
  assert.ok(rejectedAction.status >= 400);
  assert.equal(rejectedAction.headers.get("x-action-redirect"), null);

  const identity = await prisma.authUser.findUniqueOrThrow({ where: { id: session.user.id } });
  assert.ok(identity.domainUserId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: identity.domainUserId } });
  await saveProfile(prisma, owner, { displayName: "Smoke student", timezone: "UTC" });
  await completeFirstTerm(prisma, owner, {
    name: "Smoke term", academicTimezone: "UTC", startsOn: "2026-09-01", endsOn: "2026-12-31", teachingStartsOn: "2026-09-14",
  });
  const completedHome = await get("/home", cookie);
  assert.equal(completedHome.status, 200);
  const html = await completedHome.text();
  assert.ok(html.includes(email) && html.includes("Smoke term"));
  assert.ok(!html.includes(secret));
  for (const callbackURL of ["https://attacker.example/callback", "//attacker.example/callback"]) {
    assert.equal((await post("sign-in/email", { ...credentials, callbackURL })).status, 403);
  }
  assert.equal((await post("sign-out", {}, cookie, "https://attacker.example")).status, 403);
  assert.equal((await post("delete-user", {}, cookie)).status, 404);
  assert.equal((await post("sign-out", {}, cookie)).status, 200);
  assert.equal(await (await get("/api/auth/get-session", cookie)).json(), null);
  assert.equal((await get("/home", cookie)).headers.get("location"), "/sign-in");
  assert.equal((await post("sign-in/email", credentials)).status, 200);
  console.log("Live auth, home, callback, origin, and server-action checks passed");
} finally {
  await prisma.$disconnect();
}
