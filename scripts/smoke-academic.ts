import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { saveProfile, completeFirstTerm } from "../src/onboarding/service";
import { academicDate } from "../src/academic/recurrence";

const { baseURL, secret } = loadAuthConfiguration();
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("Academic smoke requires the disposable unios_test database.");
const prisma = getPrisma();
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
async function get(path: string, cookie = "") { return fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" }); }
async function account() {
  const email = `${randomUUID()}@example.test`;
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ email, name: "Academic smoke", password: "Academic-smoke-password-123!" }) });
  assert.equal(response.status, 200);
  const identity = (await response.json() as { user: { id: string } }).user;
  const cookie = response.headers.getSetCookie().find((item) => item.includes("session_token="))!.split(";")[0]!;
  assert.equal((await get("/onboarding", cookie)).status, 200);
  const authUser = await prisma.authUser.findUniqueOrThrow({ where: { id: identity.id } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: authUser.domainUserId! } });
  await saveProfile(prisma, owner, { displayName: "Academic smoke", timezone: "Asia/Kuala_Lumpur" });
  await completeFirstTerm(prisma, owner, { name: "Initial term", academicTimezone: "Asia/Kuala_Lumpur", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01" });
  return { owner, cookie };
}
async function action(name: string, data: Record<string, string>, cookie: string, origin = baseURL) {
  const id = Object.entries(manifest.node).find(([, value]) => value.exportedName === name)?.[0];
  assert.ok(id, `built action ${name} exists`);
  const form = new FormData();
  // Pinned React 19.3's FormData reference uses _<reference>_<field> keys.
  for (const [key, value] of Object.entries(data)) form.set(`_1_${key}`, value);
  // The streaming decoder must receive referenced fields before the root chunk.
  form.set("0", '["$K1"]');
  return fetch(`${baseURL}/courses`, { method: "POST", headers: { origin, cookie, "Next-Action": id }, body: form, redirect: "manual" });
}
async function save(name: string, data: Record<string, string>, cookie: string) {
  const response = await action(name, data, cookie);
  assert.ok(response.status < 400, `${name} returned ${response.status}`);
  assert.ok(response.headers.get("x-action-redirect"), `${name} redirected`);
  assert.ok(!response.headers.get("x-action-redirect")!.includes("error="), `${name} succeeded: ${response.headers.get("x-action-redirect")}`);
}
try {
  for (const path of ["/terms", "/courses", "/timetable"]) {
    const anonymous = await get(path);
    assert.equal(anonymous.status, 307); assert.equal(anonymous.headers.get("location"), "/sign-in");
  }
  const a = await account(); const b = await account();
  const day = Temporal.PlainDate.from(academicDate(new Date(), "Asia/Kuala_Lumpur"));
  const monday = day.add({ days: (1 - day.dayOfWeek + 7) % 7 + 7 });
  const nextMonday = monday.add({ days: 7 });
  const last = monday.add({ days: 35 }).toString();
  const termData = { name: `HTTP term ${randomUUID()}`, academicTimezone: "Asia/Kuala_Lumpur", startsOn: monday.toString(), teachingStartsOn: monday.toString(), endsOn: last, ownerId: b.owner.id, userId: b.owner.id };
  await save("createTermAction", termData, a.cookie);
  const term = await prisma.term.findFirstOrThrow({ where: { ownerId: a.owner.id, name: termData.name } });
  assert.equal(await prisma.term.count({ where: { ownerId: b.owner.id, name: termData.name } }), 0);
  await save("updateTermAction", { ...termData, id: term.id, name: "HTTP academic term" }, a.cookie);
  await save("termLifecycleAction", { id: term.id, status: "ACTIVE" }, a.cookie);
  await save("selectTermAction", { id: term.id }, a.cookie);
  await save("createCourseAction", { termId: term.id, courseCode: "HTTP101", title: "HTTP course", ownerId: b.owner.id }, a.cookie);
  const course = await prisma.course.findFirstOrThrow({ where: { ownerId: a.owner.id, termId: term.id } });
  await save("updateCourseAction", { id: course.id, termId: term.id, courseCode: "HTTP101", title: "Updated HTTP course" }, a.cookie);
  await save("courseLifecycleAction", { id: course.id, status: "ACTIVE" }, a.cookie);
  const series = { courseId: course.id, weekday: "1", localStartTime: "09:00", localEndTime: "10:00", endDayOffset: "0", timezone: "Asia/Kuala_Lumpur", originalStartDate: monday.toString(), originalEndDate: last, location: "HTTP room" };
  await save("createScheduleAction", series, a.cookie);
  const schedule = await prisma.classSchedule.findFirstOrThrow({ where: { ownerId: a.owner.id, courseId: course.id } });
  for (const path of ["/terms", "/courses", `/timetable?week=${monday}`]) {
    const response = await get(path, a.cookie); assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(secret));
  }
  assert.ok((await (await get(`/timetable?week=${monday}`, a.cookie)).text()).includes("HTTP room"));
  await save("exceptionAction", { scheduleId: schedule.id, originalDate: monday.toString(), kind: "CANCEL" }, a.cookie);
  assert.ok((await (await get(`/timetable?week=${monday}`, a.cookie)).text()).includes("Cancelled occurrences"));
  await save("removeExceptionAction", { scheduleId: schedule.id, originalDate: monday.toString() }, a.cookie);
  const wednesday = monday.add({ days: 2 }).toString();
  await save("exceptionAction", { scheduleId: schedule.id, originalDate: monday.toString(), kind: "MOVE", replacementStartDate: wednesday, replacementEndDate: wednesday, replacementStartTime: "15:00", replacementEndTime: "16:00", replacementTimezone: "Asia/Kuala_Lumpur", replacementLocation: "Moved HTTP room" }, a.cookie);
  assert.ok((await (await get(`/timetable?week=${monday}`, a.cookie)).text()).includes("Moved HTTP room"));
  await save("splitScheduleAction", { ...series, scheduleId: schedule.id, originalDate: nextMonday.toString(), weekday: "3", localStartTime: "11:00", localEndTime: "12:00" }, a.cookie);
  const successor = await prisma.classSchedule.findFirstOrThrow({ where: { predecessorId: schedule.id } });
  assert.equal(successor.predecessorId, schedule.id);
  await save("retireScheduleAction", { scheduleId: successor.id, originalDate: nextMonday.add({ days: 16 }).toString() }, a.cookie);
  await save("archiveCourseAction", { id: course.id, archived: "true" }, a.cookie);
  assert.ok(!(await (await get(`/timetable?week=${monday}`, a.cookie)).text()).includes("Moved HTTP room"));
  await save("archiveCourseAction", { id: course.id, archived: "false" }, a.cookie);
  const foreign = await prisma.term.findFirstOrThrow({ where: { ownerId: b.owner.id } });
  assert.equal((await get(`/courses?term=${foreign.id}`, a.cookie)).status, 404);
  const rejected = await action("selectTermAction", { id: foreign.id }, a.cookie);
  assert.ok(rejected.headers.get("x-action-redirect")?.includes("error="));
  assert.equal((await prisma.profile.findUniqueOrThrow({ where: { ownerId: a.owner.id } })).selectedTermId, term.id);
  const crossOrigin = await action("createCourseAction", { termId: term.id, courseCode: "FORGED", title: "Forged" }, a.cookie, "https://attacker.example");
  assert.ok(crossOrigin.status >= 400);
  assert.equal(await prisma.course.count({ where: { ownerId: a.owner.id, courseCode: "FORGED" } }), 0);
  await save("archiveTermAction", { id: term.id, archived: "true" }, a.cookie);
  assert.equal((await get("/home", a.cookie)).headers.get("location"), "/terms");
  assert.equal((await get("/timetable", a.cookie)).status, 200);
  await save("archiveTermAction", { id: term.id, archived: "false" }, a.cookie);
  await save("selectTermAction", { id: term.id }, a.cookie);
  assert.equal((await get("/home", a.cookie)).status, 200);
  console.log("Authenticated academic pages, all mutations, exceptions, splits, archive, forged ownership and origin smoke passed");
} finally { await prisma.$disconnect(); }
