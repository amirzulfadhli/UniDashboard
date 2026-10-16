import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { academicDate, localInstant } from "../src/academic/recurrence";
import { createCourse } from "../src/academic/records";
import { createSchedule } from "../src/academic/schedules";
import { completeFirstTerm, saveProfile } from "../src/onboarding/service";
import { createWork } from "../src/work/service";

const { baseURL, secret } = loadAuthConfiguration();
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("Agenda smoke requires disposable unios_test.");
const prisma = getPrisma(), zone = "Asia/Kuala_Lumpur";
const today = academicDate(new Date(), zone), day = Temporal.PlainDate.from(today), tomorrow = day.add({ days: 1 }).toString();
const get = (path: string, cookie = "") => fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" });
async function html(path: string, cookie: string) { const response = await get(path, cookie); assert.equal(response.status, 200); const page = await response.text(); assert.ok(!page.includes(secret)); return page; }
async function account() {
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" },
    body: JSON.stringify({ email: `${randomUUID()}@example.test`, name: "Agenda smoke", password: "Agenda-smoke-password-123!" }) });
  assert.equal(response.status, 200);
  const identity = (await response.json() as { user: { id: string } }).user;
  const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="))!.split(";")[0]!;
  await get("/onboarding", cookie);
  const auth = await prisma.authUser.findUniqueOrThrow({ where: { id: identity.id } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: auth.domainUserId! } });
  await saveProfile(prisma, owner, { displayName: "Agenda smoke", timezone: zone });
  await completeFirstTerm(prisma, owner, { name: "Agenda term", academicTimezone: zone, startsOn: day.subtract({ days: 7 }).toString(),
    endsOn: day.add({ days: 60 }).toString(), teachingStartsOn: day.subtract({ days: 7 }).toString() });
  const term = await prisma.term.findFirstOrThrow({ where: { ownerId: owner.id } });
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "AGHTTP", title: "Agenda HTTP class" });
  return { owner, cookie, term, course };
}
try {
  const anonymous = await get("/agenda"); assert.equal(anonymous.status, 307); assert.equal(anonymous.headers.get("location"), "/sign-in");
  const a = await account(), b = await account();
  const schedule = (date: string, start: string) => ({ courseId: a.course.id, weekday: Temporal.PlainDate.from(date).dayOfWeek,
    localStartTime: start, localEndTime: start === "09:00" ? "10:00" : "13:00", endDayOffset: 0,
    timezone: zone, originalStartDate: date, originalEndDate: date, location: "Agenda room" });
  await createSchedule(prisma, a.owner, schedule(today, "09:00"));
  await createSchedule(prisma, a.owner, schedule(tomorrow, "12:00"));
  await createWork(prisma, a.owner, "TASK", { title: "Today date-only task", deadlineKind: "DATE_ONLY", dueDate: today, dueTimezone: zone });
  await createWork(prisma, a.owner, "TASK", { title: "Today timed task", deadlineKind: "TIMED", dueAt: localInstant(today, "20:00", zone)!.toISOString(), dueTimezone: zone });
  await createWork(prisma, a.owner, "ASSIGNMENT", { title: "Tomorrow timed assignment", courseId: a.course.id, deadlineKind: "TIMED", dueAt: localInstant(tomorrow, "12:00", zone)!.toISOString(), dueTimezone: zone });
  await createWork(prisma, a.owner, "PROJECT", { title: "Tomorrow date-only project", deadlineKind: "DATE_ONLY", dueDate: tomorrow, dueTimezone: zone });
  await createWork(prisma, b.owner, "TASK", { title: "Foreign agenda deadline", deadlineKind: "DATE_ONLY", dueDate: today, dueTimezone: zone });
  const todayPage = await html("/agenda", a.cookie);
  assert.ok(todayPage.includes("Agenda HTTP class") && todayPage.includes("Today date-only task") && todayPage.includes("Today timed task"));
  assert.ok(todayPage.includes("All day") && todayPage.includes("TASK_DEADLINE") && todayPage.includes("Happening now") && todayPage.includes("Next timed item"));
  assert.ok(!todayPage.includes("Foreign agenda deadline"));
  const tomorrowPage = await html("/agenda?view=TOMORROW", a.cookie);
  assert.ok(tomorrowPage.includes(tomorrow) && tomorrowPage.includes("Tomorrow timed assignment") && tomorrowPage.includes("Tomorrow date-only project") && tomorrowPage.includes("Agenda HTTP class"));
  const weekPage = await html("/agenda?view=WEEK", a.cookie); assert.ok(weekPage.includes(today) && weekPage.includes("Today date-only task"));
  const upcomingPage = await html(`/agenda?view=UPCOMING&startDate=${today}&endDate=${tomorrow}`, a.cookie);
  assert.ok(upcomingPage.includes("Today date-only task") && upcomingPage.includes("Tomorrow timed assignment"));
  assert.ok((await html(`/agenda?view=UPCOMING&startDate=${today}`, a.cookie)).includes("Supply both agenda range dates"));
  const foreignTermPage = await html(`/agenda?term=${b.term.id}`, a.cookie);
  assert.ok(foreignTermPage.includes("Academic record not found"));
  assert.ok((await html(`/agenda?ownerId=${b.owner.id}`, a.cookie)).includes("Use an owned Term context"));
  assert.ok(!upcomingPage.includes("Foreign agenda deadline"));
  await saveProfile(prisma, a.owner, { displayName: "Agenda smoke", timezone: "America/New_York" });
  const fallBackPage = await html("/agenda?view=UPCOMING&startDate=2025-11-01&endDate=2026-11-01", a.cookie);
  assert.ok(fallBackPage.includes("Viewer timezone:") && fallBackPage.includes("America/New_York"));
  assert.ok(fallBackPage.includes('name="startDate"') && fallBackPage.includes('name="endDate"'));
  assert.ok(fallBackPage.includes('value="2025-11-01"') && fallBackPage.includes('value="2026-11-01"'));
  const excessivePage = await html("/agenda?view=UPCOMING&startDate=2025-11-01&endDate=2026-11-02", a.cookie);
  assert.ok(excessivePage.includes("Choose an inclusive agenda range of at most 366 calendar days."));
  console.log("Authenticated Agenda Today, Tomorrow, Week, 366-date New York fall-back Upcoming form boundary, 367-date rejection, class/timed/date-only presentation, anonymous rejection and owner isolation passed");
} finally { await prisma.$disconnect(); }
