import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

// A single private, ephemeral configuration for build + server + smoke clients.
// Never write or print this synthetic verification secret.
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("HTTP verification requires disposable unios_test.");
const env = { ...process.env, BETTER_AUTH_SECRET: randomBytes(48).toString("base64"), BETTER_AUTH_URL: "http://localhost:3000" };
const next = resolve("node_modules/next/dist/bin/next");
function run(args: string[]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Verification failed: ${args.join(" ")} (${result.status})`);
}
run([next, "build"]);
// A fresh process per suite preserves the production rate limiter while avoiding
// unrelated synthetic sign-up bursts accumulating across independent suites.
for (const script of ["smoke-auth.ts", "smoke-academic.ts", "smoke-work.ts"]) {
 const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1"], { env, stdio: "inherit", windowsHide: true });
 try {
  const deadline = Date.now() + 30000; let ready = false;
  while (!ready && Date.now() < deadline) {
    if (server.exitCode != null) throw new Error("Production server exited before readiness.");
    try { ready = (await fetch(`${env.BETTER_AUTH_URL}/sign-in`)).status === 200; } catch { /* Readiness retry only. */ }
    if (!ready) await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) throw new Error("Production server readiness timed out.");
  run(["--import", "tsx", `scripts/${script}`]);
 } finally {
  if (server.exitCode == null) { const exited = new Promise<void>((done) => server.once("exit", () => done())); server.kill(); await exited; }
 }
}
