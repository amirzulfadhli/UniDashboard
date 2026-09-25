import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL must name a disposable test PostgreSQL instance");
const baseUrl = new URL(base);
if (baseUrl.pathname !== "/unios_test") {
  throw new Error("The test harness only accepts a base database named unios_test");
}

const name = `unios_replay_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${name}`;
const databaseUrl = testUrl.toString();
const admin = new Client({ connectionString: base });

function run(label: string, args: string[], extraEnv: Record<string, string> = {}): void {
  process.stdout.write(`\n[${label}]\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  run("clean migration replay", [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", "prisma7.config.ts"]);
  run("schema and catalog integration", ["--import", "tsx", "--test", "tests/schema.test.ts"]);
  run("whitespace policy", ["--import", "tsx", "--test", "tests/whitespace.test.ts"]);
  for (const zone of ["UTC", "Asia/Kuala_Lumpur", "America/Los_Angeles"]) {
    await admin.query(`ALTER DATABASE "${name}" SET TIME ZONE '${zone}'`);
    run(`temporal: database=${zone}, process=${zone}`, ["--import", "tsx", "--test", "tests/temporal.test.ts"], {
      TZ: zone,
      TEST_DATABASE_TIMEZONE: zone,
    });
  }
  run("migration status", [resolve("node_modules/prisma/build/index.js"), "migrate", "status", "--config", "prisma7.config.ts"]);
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
