import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auth } from "../../src/auth/server";
import { getPrisma } from "../../src/auth/db";

const origin = process.env.BETTER_AUTH_URL!;
const email = `${randomUUID()}@example.test`;
const credentials = { name: "Runtime student", email, password: "Runtime-test-password-123!" };
function request(path: string, body: object, cookie = "", sourceOrigin = origin) {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: sourceOrigin, cookie }, body: JSON.stringify(body),
  }));
}

try {
  const signup = await request("sign-up/email", credentials);
  assert.equal(signup.status, 200);
  const cookieHeader = signup.headers.getSetCookie().find((value) => value.includes("session_token="));
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.equal(/;\s*Secure(?:;|$)/i.test(cookieHeader), origin.startsWith("https:"));
  const cookie = cookieHeader.split(";")[0]!;
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.email, email);

  for (const callbackURL of ["https://attacker.example/callback", "//attacker.example/callback"]) {
    const response = await request("sign-in/email", { ...credentials, callbackURL });
    assert.equal(response.status, 403);
  }
  assert.equal((await request("sign-out", {}, cookie, "https://attacker.example")).status, 403);
  assert.ok(await auth.api.getSession({ headers: new Headers({ cookie }) }));
  assert.equal((await request("sign-out", {}, cookie)).status, 200);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
  const signin = await request("sign-in/email", credentials);
  assert.equal(signin.status, 200);
  assert.ok(signin.headers.getSetCookie().some((value) => value.includes("session_token=")));
  console.log("Auth runtime checks passed");
} finally {
  await getPrisma().$disconnect();
}
