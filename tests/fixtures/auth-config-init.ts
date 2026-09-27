import assert from "node:assert/strict";

const scenarios = JSON.parse(process.env.TASK_AUTH_CASES!) as { secret?: string; url?: string; secrets?: string }[];
const moduleURL = new URL("../../src/auth/server.ts", import.meta.url);
for (const [index, scenario] of scenarios.entries()) {
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.BETTER_AUTH_SECRETS;
  if (scenario.secret !== undefined) process.env.BETTER_AUTH_SECRET = scenario.secret;
  if (scenario.url !== undefined) process.env.BETTER_AUTH_URL = scenario.url;
  if (scenario.secrets !== undefined) process.env.BETTER_AUTH_SECRETS = scenario.secrets;
  // Fresh ESM module evaluation per case; dependencies may be shared safely.
  await assert.rejects(import(`${moduleURL.href}?invalidCase=${index}`), (error: unknown) => {
    assert.equal((error as Error).name, "AuthConfigurationError");
    return true;
  });
}
process.env.BETTER_AUTH_SECRET = process.env.TASK_TEST_SECRET!;
delete process.env.BETTER_AUTH_SECRETS;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const valid = await import(`${moduleURL.href}?validControl`);
assert.equal(valid.auth.options.secret, process.env.TASK_TEST_SECRET);
assert.equal(valid.auth.options.baseURL, "http://localhost:3000");
console.log(`Rejected ${scenarios.length} invalid initialization cases`);
// The valid control constructs a pool but makes no database request.
process.exit(0);
