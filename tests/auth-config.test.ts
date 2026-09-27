import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { AuthConfigurationError, loadAuthConfiguration } from "../src/auth/config.js";

const privateTestSecret = randomBytes(32).toString("base64");
const badSecrets = [undefined, "", "   ", "short", "a".repeat(31), "replace-with-a-unique-random-secret-at-least-32-bytes", "better-auth-secret-12345678901234567890"];
const badURLs = [undefined, "", "   ", "not a url", "/relative", "//example.com", "ftp://example.com", "https://user:password@example.com", "https://@example.com", "https://example.com/path", "https://example.com?query=1", "https://example.com#fragment", "https://example.com?", "https://example.com#", "https:example.com", "https:///example.com", "https://example.com\\path"];

test("configuration rejects every invalid secret and URL without disclosing values", () => {
  assert.throws(() => loadAuthConfiguration({ BETTER_AUTH_SECRET: privateTestSecret, BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRETS: "unsupported" }), AuthConfigurationError);
  for (const secret of badSecrets) {
    const env = { BETTER_AUTH_URL: "http://localhost:3000", ...(secret === undefined ? {} : { BETTER_AUTH_SECRET: secret }) };
    assert.throws(() => loadAuthConfiguration(env), AuthConfigurationError);
  }
  for (const url of badURLs) {
    const env = { BETTER_AUTH_SECRET: privateTestSecret, ...(url === undefined ? {} : { BETTER_AUTH_URL: url }) };
    assert.throws(() => loadAuthConfiguration(env), (error: unknown) => {
      assert.ok(error instanceof AuthConfigurationError);
      assert.ok(!error.message.includes(privateTestSecret));
      return true;
    });
  }
});

test("configuration accepts and normalizes explicit HTTP and HTTPS origins", () => {
  for (const [input, expected] of [["http://localhost:3000", "http://localhost:3000"], ["https://EXAMPLE.com:443/", "https://example.com"]]) {
    const configuration = loadAuthConfiguration({ BETTER_AUTH_SECRET: privateTestSecret, BETTER_AUTH_URL: input });
    assert.equal(configuration.baseURL, expected);
    assert.equal(configuration.secret, privateTestSecret);
    assert.ok(Object.isFrozen(configuration));
  }
});

test("actual auth module fails before initialization in development and production", () => {
  const scenarios = [
    ...badSecrets.map((secret) => ({ secret, url: "http://localhost:3000" })),
    ...badURLs.map((url) => ({ secret: privateTestSecret, url })),
    { secret: privateTestSecret, url: "http://localhost:3000", secrets: "unsupported" },
  ];
  for (const mode of ["development", "production"] as const) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/fixtures/auth-config-init.ts"], {
      env: { ...process.env, DOTENV_CONFIG_PATH: "tests/fixtures/no-config.env", NODE_ENV: mode, DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", TASK_AUTH_CASES: JSON.stringify(scenarios), TASK_TEST_SECRET: privateTestSecret },
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `auth initialization must reject invalid configuration in ${mode}`);
    assert.match(result.stdout, new RegExp(`Rejected ${scenarios.length} invalid initialization cases`));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privateTestSecret));
  }
});
