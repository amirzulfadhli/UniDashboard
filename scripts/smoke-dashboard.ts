import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { academicDate } from "../src/academic/recurrence";
import { createCourse } from "../src/academic/records";
import { createSchedule } from "../src/academic/schedules";
import { completeFirstTerm, saveProfile } from "../src/onboarding/service";
import { createWork } from "../src/work/service";

const { baseURL, secret } = loadAuthConfiguration();
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("Dashboard smoke requires disposable unios_test.");
const db = getPrisma(), zone = "Asia/Kuala_Lumpur";
const day = Temporal.PlainDate.from(academicDate(new Date(), zone));
const get = (path: string, cookie = "") => fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" });
async function html(path: string, cookie: string) {
  const response = await get(path, cookie); assert.equal(response.status, 200);
  const page = await response.text(); assert.ok(!page.includes(secret)); assert.ok(!page.includes("PrismaClientKnownRequestError")); return page;
}
async function account() {
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" },
    body: JSON.stringify({ email: `${randomUUID()}@example.test`, name: "Dashboard smoke", password: "Dashboard-smoke-password-123!" }) });
  assert.equal(response.status, 200);
  const identity = (await response.json() as { user: { id: string } }).user;
  const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="))!.split(";")[0]!;
  assert.equal((await get("/home", cookie)).headers.get("location"), "/onboarding");
  await get("/onboarding", cookie);
  const auth = await db.authUser.findUniqueOrThrow({ where: { id: identity.id } });
  const owner = await db.user.findUniqueOrThrow({ where: { id: auth.domainUserId! } });
  await saveProfile(db, owner, { displayName: "Dashboard <script>unsafe</script>", timezone: zone });
  await completeFirstTerm(db, owner, { name: "Dashboard term", academicTimezone: "America/New_York", startsOn: day.subtract({ days: 30 }).toString(),
    endsOn: day.add({ days: 90 }).toString(), teachingStartsOn: day.subtract({ days: 30 }).toString() });
  const term = await db.term.findFirstOrThrow({ where: { ownerId: owner.id } });
  const course = await createCourse(db, owner, { termId: term.id, courseCode: "DASH101", title: "Dashboard class" });
  return { owner, cookie, course, term };
}
try {
  const anonymous = await get("/home"); assert.equal(anonymous.status, 307); assert.equal(anonymous.headers.get("location"), "/sign-in");
  const a = await account(), b = await account();
  const empty = await html("/home", a.cookie);
  assert.ok(empty.includes("A little breathing room") && empty.includes("A fresh page") && empty.includes("Nothing pressing"));
  await createSchedule(db, a.owner, { courseId: a.course.id, weekday: day.dayOfWeek, localStartTime: "09:00", localEndTime: "10:00", endDayOffset: 0,
    timezone: zone, originalStartDate: day.toString(), originalEndDate: day.toString(), location: "Dashboard studio" });
  const task = await createWork(db, a.owner, "TASK", { title: "Dashboard priority task", priority: "HIGH", deadlineKind: "DATE_ONLY", dueDate: day.toString(), dueTimezone: zone });
  await createWork(db, a.owner, "PROJECT", { title: "Dashboard overdue project", deadlineKind: "DATE_ONLY", dueDate: day.subtract({ days: 1 }).toString(), dueTimezone: zone });
  await createWork(db, a.owner, "ASSIGNMENT", { title: "Dashboard future assignment", courseId: a.course.id, deadlineKind: "TIMED", dueAt: new Date(Date.now() + 2 * 86400000).toISOString(), dueTimezone: "America/New_York" });
  await createWork(db, b.owner, "TASK", { title: "FOREIGN DASHBOARD SECRET", priority: "URGENT" });
  const page = await html(`/home?ownerId=${b.owner.id}&term=${b.term.id}`, a.cookie);
  for (const value of ["Dashboard class", "Dashboard studio", "Dashboard priority task", "Dashboard overdue project", "Dashboard future assignment", "All day", "Asia/Kuala_Lumpur", "America/New_York", "Overdue", "Due today"])
    assert.ok(page.includes(value), value);
  assert.ok(!page.includes("FOREIGN DASHBOARD SECRET") && !page.includes("<script>unsafe</script>"));
  assert.ok(page.includes('href="/work#work-' + task.id + '"'));
  const create = await html("/work?create=TASK", a.cookie);
  assert.match(create, /id="new-task"[^>]*><details open=""/);
  assert.ok(create.includes('name="title"'));
  const work = await html("/work", a.cookie); assert.ok(work.includes(`id="work-${task.id}"`));
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const actionId = Object.entries(manifest.node).find(([, value]) => value.exportedName === "workLifecycleAction")?.[0]; assert.ok(actionId);
  const form = new FormData();
  for (const [key, value] of Object.entries({ kind: "TASK", id: task.id, status: "DONE" })) form.set(`_1_${key}`, value);
  form.set("0", '["$K1"]');
  const completed = await fetch(`${baseURL}/work`, { method: "POST", headers: { origin: baseURL, cookie: a.cookie, "Next-Action": actionId }, body: form, redirect: "manual" });
  assert.ok(completed.status < 400); assert.ok(!completed.headers.get("x-action-redirect")?.includes("error="));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, "DONE");
  assert.ok(!(await html("/home", a.cookie)).includes("Dashboard priority task"));
  for (let offset = 0; offset < 5000; offset += 500) await db.task.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
    ownerId: a.owner.id, title: `Dashboard volume ${offset + index}`, priority: "HIGH" as const,
    description: "Details outside the dashboard projection. ".repeat(200), deadlineKind: "TIMED" as const,
    dueAt: new Date(Date.now() + ((offset + index) * 7919 % 5000) * 1000), dueTimezone: "America/New_York",
  })) });
  const volume = await html("/home", a.cookie);
  assert.match(volume, /Open tasks<\/span><strong>5000<small>/);
  assert.ok(volume.includes("Dashboard volume") && !volume.includes("Your overview couldn’t load"));
  assert.ok(!volume.includes("Details outside the dashboard projection."));
  await db.profile.update({ where: { ownerId: a.owner.id }, data: { selectedTermId: null } });
  assert.equal((await get("/home", a.cookie)).headers.get("location"), "/terms");
  console.log("Dashboard protected/setup gates, empty/rich and 5,000-task snapshots, viewer/source timezones, classes, deadlines, task links, terminal refresh, escaping and forged-owner isolation passed");
} finally { await db.$disconnect(); }
