import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { saveProfile, completeFirstTerm } from "../src/onboarding/service";
import { academicDate } from "../src/academic/recurrence";
import { createCourse } from "../src/academic/records";
const { baseURL, secret } = loadAuthConfiguration();
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("Work smoke requires the disposable unios_test database.");
const prisma = getPrisma();
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
const get = (path: string, cookie = "") => fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" });
async function account() {
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ email: `${randomUUID()}@example.test`, name: "Work smoke", password: "Work-smoke-password-123!" }) });
  assert.equal(response.status, 200);
  const identity = (await response.json() as { user: { id: string } }).user;
  const cookie = response.headers.getSetCookie().find((item) => item.includes("session_token="))!.split(";")[0]!;
  await get("/onboarding", cookie);
  const auth = await prisma.authUser.findUniqueOrThrow({ where: { id: identity.id } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: auth.domainUserId! } });
  await saveProfile(prisma, owner, { displayName: "Work smoke", timezone: "Asia/Kuala_Lumpur" });
  await completeFirstTerm(prisma, owner, { name: "Work term", academicTimezone: "Europe/London", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01" });
  const term = await prisma.term.findFirstOrThrow({ where: { ownerId: owner.id } });
  const course = await createCourse(prisma, owner, { termId: term.id, title: "HTTP academic work", courseCode: "WORKHTTP" });
  return { owner, cookie, term, course };
}
async function action(name: string, data: Record<string, string>, cookie: string, origin = baseURL) {
  const id = Object.entries(manifest.node).find(([, value]) => value.exportedName === name)?.[0]; assert.ok(id, `built action ${name}`);
  const form = new FormData(); for (const [key, value] of Object.entries(data)) form.set(`_1_${key}`, value); form.set("0", '["$K1"]');
  return fetch(`${baseURL}/work`, { method: "POST", headers: { origin, cookie, "Next-Action": id }, body: form, redirect: "manual" });
}
async function save(name: string, data: Record<string, string>, cookie: string) {
  const response = await action(name, data, cookie); assert.ok(response.status < 400);
  assert.ok(response.headers.get("x-action-redirect")); assert.ok(!response.headers.get("x-action-redirect")!.includes("error="), `${name}: ${response.headers.get("x-action-redirect")}`);
}
async function rejected(name: string, data: Record<string, string>, cookie: string) { assert.ok((await action(name, data, cookie)).headers.get("x-action-redirect")?.includes("error=")); }
function inputs(form: string) {
  return Object.fromEntries(Array.from(form.matchAll(/<input\b[^>]*>/g)).flatMap(([tag]) => {
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    return name ? [[name, tag.match(/\bvalue="([^"]*)"/)?.[1] ?? ""]] : [];
  }));
}
function deadlineOptions(form: string) {
  const select = Array.from(form.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g), (match) => match[0]).find((tag) => /\bname="deadlineKind"/.test(tag));
  assert.ok(select, "rendered deadline selection exists");
  return Array.from(select.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g), (match) => match[1]);
}
function renderedForm(html: string, kind: string, id?: string, operation?: string) {
  const form = Array.from(html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g), (match) => match[1]!).find((candidate) => {
    const fields = inputs(candidate);
    return fields.kind === kind && (id ? fields.id === id : !fields.id) && (operation ? fields.operation === operation : !fields.operation);
  });
  assert.ok(form, `rendered ${kind} ${operation ?? "work creation"} form exists`);
  return form;
}
async function deadlineForm(path: string, cookie: string, kind: string, id: string, operation: string) {
  const response = await get(path, cookie); assert.equal(response.status, 200);
  const form = renderedForm(await response.text(), kind, id, operation);
  if (operation === "REMOVE") assert.ok(!form.includes('name="deadlineKind"'), "removal stays an explicit action");
  else assert.deepEqual(deadlineOptions(form), ["DATE_ONLY", "TIMED"], `${kind} ${operation} must not offer unsavable NONE`);
  return { kind: inputs(form).kind!, id: inputs(form).id!, operation: inputs(form).operation! };
}
try {
  for (const path of ["/work", "/projects"]) { const response = await get(path); assert.equal(response.status, 307); assert.equal(response.headers.get("location"), "/sign-in"); }
  const a = await account(), b = await account();
  const today = Temporal.PlainDate.from(academicDate(new Date(), "Asia/Kuala_Lumpur"));
  const title = `HTTP project ${randomUUID()}`;
  await save("createWorkAction", { kind: "PROJECT", title, ownerId: b.owner.id }, a.cookie);
  const project = await prisma.project.findFirstOrThrow({ where: { ownerId: a.owner.id, title } });
  await save("updateWorkAction", { kind: "PROJECT", id: project.id, title: "HTTP updated project", homeTermId: a.term.id }, a.cookie);
  await save("workLifecycleAction", { kind: "PROJECT", id: project.id, status: "ACTIVE" }, a.cookie);
  await save("createWorkAction", { kind: "ASSIGNMENT", title: "HTTP assignment", courseId: a.course.id }, a.cookie);
  const assignment = await prisma.assignment.findFirstOrThrow({ where: { ownerId: a.owner.id } });
  await save("updateWorkAction", { kind: "ASSIGNMENT", id: assignment.id, title: "HTTP edited assignment", courseId: a.course.id }, a.cookie);
  await save("createWorkAction", { kind: "TASK", title: "HTTP today task", projectId: project.id, assignmentId: assignment.id, deadlineKind: "DATE_ONLY", dueDate: today.toString(), dueTimezone: "Asia/Kuala_Lumpur", userId: b.owner.id }, a.cookie);
  const task = await prisma.task.findFirstOrThrow({ where: { ownerId: a.owner.id } });
  await save("updateWorkAction", { kind: "TASK", id: task.id, title: "HTTP edited task", assignmentId: assignment.id, projectId: project.id, priority: "HIGH" }, a.cookie);
  for (const path of ["/work", "/projects", "/work?view=TODAY", `/work?view=DUE_ON&date=${today}`, `/work?course=${a.course.id}`, `/work?project=${project.id}`]) { const response = await get(path, a.cookie); assert.equal(response.status, 200); const html = await response.text(); assert.ok(!html.includes(secret)); if (!path.startsWith("/projects")) assert.ok(html.includes("HTTP edited task")); }
  await save("deadlineAction", { kind: "TASK", id: task.id, operation: "UPDATE", deadlineKind: "DATE_ONLY", dueDate: today.add({ days: 1 }).toString(), dueTimezone: "Asia/Kuala_Lumpur" }, a.cookie);
  assert.ok((await (await get("/work?view=UPCOMING", a.cookie)).text()).includes("HTTP edited task"));
  await save("deadlineAction", { kind: "TASK", id: task.id, operation: "UPDATE", deadlineKind: "DATE_ONLY", dueDate: today.subtract({ days: 1 }).toString(), dueTimezone: "Asia/Kuala_Lumpur" }, a.cookie);
  assert.ok((await (await get("/work?view=OVERDUE", a.cookie)).text()).includes("HTTP edited task"));
  await save("workLifecycleAction", { kind: "TASK", id: task.id, status: "DONE" }, a.cookie);
  assert.ok(!(await (await get("/work?view=OVERDUE", a.cookie)).text()).includes("HTTP edited task"));
  await save("archiveWorkAction", { kind: "TASK", id: task.id, archived: "true" }, a.cookie);
  await rejected("archiveWorkAction", { kind: "TASK", id: task.id, archived: "malformed" }, a.cookie);
  assert.ok((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).archivedAt);
  await save("archiveWorkAction", { kind: "TASK", id: task.id, archived: "false" }, a.cookie);
  await save("workLifecycleAction", { kind: "TASK", id: task.id, status: "TODO" }, a.cookie);
  assert.ok((await (await get("/work?view=OVERDUE", a.cookie)).text()).includes("HTTP edited task"));
  await save("deadlineAction", { kind: "TASK", id: task.id, operation: "REMOVE" }, a.cookie);
  await save("deadlineAction", { kind: "TASK", id: task.id, operation: "CREATE", deadlineKind: "TIMED", dueLocalDate: today.add({ days: 1 }).toString(), dueLocalTime: "09:30", dueTimezone: "Asia/Kuala_Lumpur" }, a.cookie);
  await save("archiveWorkAction", { kind: "PROJECT", id: project.id, archived: "true" }, a.cookie);
  assert.ok((await (await get("/work", a.cookie)).text()).includes("HTTP edited task"));
  assert.ok(!(await (await get(`/work?project=${project.id}`, a.cookie)).text()).includes("HTTP edited task"));
  await save("archiveWorkAction", { kind: "PROJECT", id: project.id, archived: "false" }, a.cookie);
  await save("workLifecycleAction", { kind: "ASSIGNMENT", id: assignment.id, status: "SUBMITTED" }, a.cookie);
  await save("archiveWorkAction", { kind: "ASSIGNMENT", id: assignment.id, archived: "true" }, a.cookie);
  await save("archiveWorkAction", { kind: "ASSIGNMENT", id: assignment.id, archived: "false" }, a.cookie);
  await save("workLifecycleAction", { kind: "ASSIGNMENT", id: assignment.id, status: "IN_PROGRESS" }, a.cookie);
  for (const path of [`/work?course=${b.course.id}`, `/work?project=${project.id}`, "/work?course=not-a-uuid"]) { const response = await get(path, path.includes(project.id) ? b.cookie : a.cookie); assert.equal(response.status, 404); }
  for (const [name, data] of [["updateWorkAction", { kind: "TASK", id: task.id, title: "Forged" }], ["archiveWorkAction", { kind: "TASK", id: task.id, archived: "false" }], ["workLifecycleAction", { kind: "TASK", id: task.id, status: "DONE" }], ["deadlineAction", { kind: "TASK", id: task.id, operation: "REMOVE" }]] as const) await rejected(name, data, b.cookie);
  await rejected("createWorkAction", { kind: "ASSIGNMENT", title: "Foreign", courseId: b.course.id }, a.cookie);
  await rejected("deadlineAction", { kind: "TASK", id: task.id, operation: "UPDATE", deadlineKind: "DATE_ONLY", dueDate: "2026-02-30", dueTimezone: "UTC" }, a.cookie);
  await rejected("createWorkAction", { kind: "COURSE", title: "Unsupported" }, a.cookie);
  const anonymous = await action("createWorkAction", { kind: "TASK", title: "Anonymous forged" }, "");
  assert.ok(anonymous.headers.get("x-action-redirect")?.includes("/sign-in"));
  assert.ok((await action("createWorkAction", { kind: "TASK", title: "Origin forged" }, a.cookie, "https://attacker.example")).status >= 400);
  assert.equal(await prisma.task.count({ where: { title: { in: ["Anonymous forged", "Origin forged", "Forged"] } } }), 0);
  // M1 regression checks real production HTML, then submits its action identity.
  for (const kind of ["TASK", "PROJECT", "ASSIGNMENT"] as const) {
    const path = kind === "PROJECT" ? "/projects" : `/work?view=MANAGEMENT&kind=${kind}`;
    const creationResponse = await get(path, a.cookie); assert.equal(creationResponse.status, 200);
    const creation = renderedForm(await creationResponse.text(), kind);
    assert.deepEqual(deadlineOptions(creation), ["NONE", "DATE_ONLY", "TIMED"]);
    assert.match(creation, /<option selected="">NONE<\/option>/);
    const title = `M1 ${kind} ${randomUUID()}`;
    await save("createWorkAction", { kind: inputs(creation).kind!, title, deadlineKind: "NONE", ...(kind === "ASSIGNMENT" ? { courseId: a.course.id } : {}) }, a.cookie);
    const where = { ownerId: a.owner.id, title };
    const read = () => kind === "TASK" ? prisma.task.findFirstOrThrow({ where }) : kind === "PROJECT" ? prisma.project.findFirstOrThrow({ where }) : prisma.assignment.findFirstOrThrow({ where });
    const row = await read(); assert.equal(row.deadlineKind, "NONE");
    const datePayload = { deadlineKind: "DATE_ONLY", dueDate: today.add({ days: 1 }).toString(), dueTimezone: "Asia/Kuala_Lumpur" };
    await save("deadlineAction", { ...await deadlineForm(path, a.cookie, kind, row.id, "CREATE"), ...datePayload }, a.cookie);
    assert.equal((await read()).dueDate!.toISOString().slice(0, 10), datePayload.dueDate);
    const timedPayload = { deadlineKind: "TIMED", dueLocalDate: today.add({ days: 1 }).toString(), dueLocalTime: "09:30", dueTimezone: "Asia/Kuala_Lumpur" };
    await save("deadlineAction", { ...await deadlineForm(path, a.cookie, kind, row.id, "UPDATE"), ...timedPayload }, a.cookie);
    const timed = await read(); assert.equal(timed.deadlineKind, "TIMED"); assert.equal(timed.dueDate, null); assert.ok(timed.dueAt);
    await save("deadlineAction", { ...await deadlineForm(path, a.cookie, kind, row.id, "UPDATE"), ...datePayload }, a.cookie);
    assert.equal((await read()).deadlineKind, "DATE_ONLY");
    await save("deadlineAction", await deadlineForm(path, a.cookie, kind, row.id, "REMOVE"), a.cookie);
    const removed = await read(); assert.equal(removed.deadlineKind, "NONE"); assert.equal(removed.dueDate, null); assert.equal(removed.dueAt, null); assert.equal(removed.dueTimezone, null);
    await save("deadlineAction", { ...await deadlineForm(path, a.cookie, kind, row.id, "CREATE"), ...timedPayload }, a.cookie);
    assert.equal((await read()).deadlineKind, "TIMED");
    await save("deadlineAction", await deadlineForm(path, a.cookie, kind, row.id, "REMOVE"), a.cookie);
    await deadlineForm(path, a.cookie, kind, row.id, "CREATE");
    console.log(`M1 ${kind}: creation NONE; rendered Add/Edit DATE_ONLY/TIMED only; both saves and explicit removal passed`);
  }
  console.log("Authenticated work/project/assignment UI, deadline forms, lifecycle/archive, context/date views, ownership, malformed/anonymous/origin HTTP smoke passed");
} finally { await prisma.$disconnect(); }
