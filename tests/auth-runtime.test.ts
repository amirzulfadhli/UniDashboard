import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

test("valid HTTP and HTTPS auth configuration preserves flows and origin protections", () => {
  for (const baseURL of ["http://localhost:3000", "https://example.com"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/fixtures/auth-runtime.ts"], {
      env: { ...process.env, DOTENV_CONFIG_PATH: "tests/fixtures/no-config.env", BETTER_AUTH_SECRETS: "", BETTER_AUTH_SECRET: randomBytes(32).toString("base64"), BETTER_AUTH_URL: baseURL },
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Auth runtime checks passed/);
  }
});
