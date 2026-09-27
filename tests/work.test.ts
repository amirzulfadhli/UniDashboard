import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/db/client";
import { withOwnerTransaction } from "../src/db/owner-transaction";
import { AcademicError } from "../src/academic/errors";
import { archiveCourse, archiveTerm, courseLifecycle, createCourse, createTerm, termLifecycle } from "../src/academic/records";
import { archiveWork, changeDeadline, createWork, getDeadline, ownedWork, updateWork, workLifecycle } from "../src/work/service";
import { queryWork, workOptions } from "../src/work/queries";

const prisma = createPrismaClient();
after(async () => prisma.$disconnect());
const code = (expected: string) => (error: unknown) => error instanceof AcademicError && error.code === expected;
const dateDeadline = { deadlineKind: "DATE_ONLY", dueDate: "2026-10-15", dueTimezone: "Asia/Kuala_Lumpur" };
async function fixture() {
  const owner = await prisma.user.create({ data: {} });
  await prisma.profile.create({ data: { ownerId: owner.id, timezone: "Asia/Kuala_Lumpur" } });
  const term = await createTerm(prisma, owner, { name: "Work term", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01", academicTimezone: "Europe/London" });
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "WORK101", title: "Work course" });
  const project = await createWork(prisma, owner, "PROJECT", { title: "Project" });
  const assignment = await createWork(prisma, owner, "ASSIGNMENT", { title: "Assignment", courseId: course.id });
  const task = await createWork(prisma, owner, "TASK", { title: "Task", projectId: project.id, assignmentId: assignment.id });
  return { owner, term, course, project, assignment, task };
}

test("all work kinds and deadline operations isolate owners and reject forged contexts", async () => {
  const a = await fixture(), b = await fixture();
  for (const [kind, record] of [["TASK", b.task], ["PROJECT", b.project], ["ASSIGNMENT", b.assignment]] as const) {
    for (const attempt of [
      () => ownedWork(prisma, a.owner, kind, record.id), () => getDeadline(prisma, a.owner, kind, record.id),
      () => updateWork(prisma, a.owner, kind, record.id, { title: "Forged", ...(kind === "ASSIGNMENT" ? { courseId: a.course.id } : {}) }),
      () => workLifecycle(prisma, a.owner, kind, record.id, kind === "TASK" ? "DONE" : kind === "PROJECT" ? "COMPLETED" : "SUBMITTED"),
      () => archiveWork(prisma, a.owner, kind, record.id, true), () => archiveWork(prisma, a.owner, kind, record.id, false),
      ...["CREATE", "UPDATE", "REMOVE"].map((operation) => () => changeDeadline(prisma, a.owner, kind, record.id, operation, dateDeadline)),
    ]) await assert.rejects(attempt(), code("NOT_FOUND"));
    const created = await createWork(prisma, a.owner, kind, { title: "Owned", id: record.id, taskId: b.task.id, deadlineId: record.id, ownerId: b.owner.id, userId: b.owner.id, authUserId: b.owner.id, ...(kind === "ASSIGNMENT" ? { courseId: a.course.id } : {}), ...dateDeadline });
    assert.equal(created.ownerId, a.owner.id);
    assert.notEqual(created.id, record.id);
    const edited = await updateWork(prisma, a.owner, kind, created.id, { title: "Still owned", ownerId: b.owner.id, userId: b.owner.id, authUserId: b.owner.id, ...(kind === "ASSIGNMENT" ? { courseId: a.course.id } : {}) });
    assert.equal(edited.ownerId, a.owner.id);
  }
  for (const context of [{ termId: b.term.id }, { courseId: b.course.id }, { assignmentId: b.assignment.id }, { projectId: b.project.id }]) {
    await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "Bad context", ...context }), code("NOT_FOUND"));
    await assert.rejects(updateWork(prisma, a.owner, "TASK", a.task.id, { title: "Bad context", ...context }), code("NOT_FOUND"));
  }
  for (const context of [{ courseId: b.course.id }, { homeTermId: b.term.id }]) await assert.rejects(createWork(prisma, a.owner, "PROJECT", { title: "Bad project", ...context }), code("NOT_FOUND"));
  await assert.rejects(createWork(prisma, a.owner, "ASSIGNMENT", { title: "Bad assignment", courseId: b.course.id }), code("NOT_FOUND"));
  for (const view of ["ACTIVE", "TODAY", "DUE_ON", "UPCOMING", "OVERDUE", "MANAGEMENT"] as const) {
    const range = { date: "2026-10-15", startDate: "2026-10-15", endDate: "2026-10-30", end: new Date("2026-10-30"), now: new Date("2026-10-15") };
    await assert.rejects(queryWork(prisma, a.owner, { view, ...range, courseId: b.course.id }), code("NOT_FOUND"));
    await assert.rejects(queryWork(prisma, a.owner, { view, ...range, projectId: b.project.id }), code("NOT_FOUND"));
  }
  assert.ok((await queryWork(prisma, a.owner, { view: "MANAGEMENT", includeArchived: true })).every((row) => row.ownerId === a.owner.id));
  assert.ok((await workOptions(prisma, a.owner)).projects.every((row) => row.ownerId === a.owner.id));
  assert.equal((await ownedWork(prisma, b.owner, "TASK", b.task.id)).title, "Task");
});

test("supported context combinations span courses and terms without transitive project equality", async () => {
  const a = await fixture();
  const otherTerm = await createTerm(prisma, a.owner, { name: "Other", startsOn: "2027-01-01", endsOn: "2027-12-31", teachingStartsOn: "2027-01-01", academicTimezone: "UTC" });
  const otherCourse = await createCourse(prisma, a.owner, { termId: otherTerm.id, courseCode: "OTHER", title: "Other" });
  const assignment = await createWork(prisma, a.owner, "ASSIGNMENT", { title: "Other assignment", courseId: otherCourse.id });
  const mixed = await createWork(prisma, a.owner, "TASK", { title: "Cross period organization", assignmentId: assignment.id, projectId: a.project.id });
  const termTask = await createWork(prisma, a.owner, "TASK", { title: "Term organization", termId: otherTerm.id, projectId: a.project.id });
  const direct = await createWork(prisma, a.owner, "TASK", { title: "Direct academic", courseId: a.course.id });
  await createWork(prisma, a.owner, "PROJECT", { title: "Home term project", homeTermId: otherTerm.id });
  const projectRows = await queryWork(prisma, a.owner, { projectId: a.project.id });
  assert.ok([mixed.id, termTask.id, a.task.id].every((id) => projectRows.some((row) => row.id === id)));
  assert.ok(!(await queryWork(prisma, a.owner, { courseId: a.course.id })).some((row) => row.id === mixed.id));
  assert.ok((await queryWork(prisma, a.owner, { courseId: a.course.id })).some((row) => row.id === direct.id));
  for (const context of [{ courseId: a.course.id, projectId: a.project.id }, { assignmentId: a.assignment.id, courseId: a.course.id }, { courseId: a.course.id, termId: a.term.id }]) await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "Unsupported physical shape", ...context }), code("INVALID_INPUT"));
  await assert.rejects(createWork(prisma, a.owner, "PROJECT", { title: "Invalid project", homeTermId: a.term.id, courseId: a.course.id }), code("INVALID_INPUT"));
  await assert.rejects(createWork(prisma, a.owner, "ASSIGNMENT", { title: "Invalid assignment", courseId: a.course.id, projectId: a.project.id }), code("INVALID_INPUT"));
});

test("archive/terminal parent retains work, blocks new attachments and hides only context views", async () => {
  const a = await fixture();
  const general = async () => assert.ok((await queryWork(prisma, a.owner)).some((row) => row.id === a.task.id));
  for (const parent of ["project", "course", "term"] as const) {
    const archive = (value: boolean) => parent === "project" ? archiveWork(prisma, a.owner, "PROJECT", a.project.id, value) : parent === "course" ? archiveCourse(prisma, a.owner, a.course.id, value) : archiveTerm(prisma, a.owner, a.term.id, value);
    await archive(true); await general();
    assert.equal((await queryWork(prisma, a.owner, parent === "project" ? { projectId: a.project.id } : { courseId: a.course.id })).length, 0);
    await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "New attachment", ...(parent === "project" ? { projectId: a.project.id } : { courseId: a.course.id }) }), code("INVALID_STATE"));
    await updateWork(prisma, a.owner, "TASK", a.task.id, { title: "Historical editable", assignmentId: a.assignment.id, projectId: a.project.id });
    assert.equal((await ownedWork(prisma, a.owner, "TASK", a.task.id)).archivedAt, null);
    await archive(false);
    assert.ok((await queryWork(prisma, a.owner, parent === "project" ? { projectId: a.project.id } : { courseId: a.course.id })).some((row) => row.id === a.task.id));
  }
  await workLifecycle(prisma, a.owner, "PROJECT", a.project.id, "COMPLETED");
  await general();
  await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "Closed project", projectId: a.project.id }), code("INVALID_STATE"));
  await courseLifecycle(prisma, a.owner, a.course.id, "COMPLETED");
  await general();
  await assert.rejects(createWork(prisma, a.owner, "ASSIGNMENT", { title: "Closed course", courseId: a.course.id }), code("INVALID_STATE"));
  await termLifecycle(prisma, a.owner, a.term.id, "CLOSED");
  await general();
  await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "Closed term", termId: a.term.id }), code("INVALID_STATE"));
});

test("all lifecycles retain monotonic completion/submission/cancellation evidence and independent archive", async () => {
  const a = await fixture();
  for (const [kind, row, terminal, active, evidence] of [["TASK", a.task, "DONE", "TODO", "lastCompletedAt"], ["PROJECT", a.project, "COMPLETED", "ACTIVE", "lastCompletedAt"], ["ASSIGNMENT", a.assignment, "GRADED", "IN_PROGRESS", "lastGradedAt"]] as const) {
    const done = await workLifecycle(prisma, a.owner, kind, row.id, terminal);
    assert.ok((done as unknown as Record<string, unknown>)[evidence]);
    await archiveWork(prisma, a.owner, kind, row.id, "true");
    if (kind !== "PROJECT") await assert.rejects(workLifecycle(prisma, a.owner, kind, row.id, active), code("INVALID_STATE"));
    await archiveWork(prisma, a.owner, kind, row.id, "false");
    const reopened = await workLifecycle(prisma, a.owner, kind, row.id, active);
    assert.deepEqual((reopened as unknown as Record<string, unknown>)[evidence], (done as unknown as Record<string, unknown>)[evidence]);
    assert.ok(reopened.lastReopenedAt);
    const cancelled = await workLifecycle(prisma, a.owner, kind, row.id, "CANCELLED");
    const reinstated = await workLifecycle(prisma, a.owner, kind, row.id, active);
    assert.deepEqual(reinstated.lastCancelledAt, cancelled.lastCancelledAt); assert.ok(reinstated.lastReinstatedAt);
  }
  for (const value of [undefined, null, "", "maybe", "TRUE", 0, 1]) await assert.rejects(archiveWork(prisma, a.owner, "TASK", a.task.id, value), code("INVALID_INPUT"));
  assert.equal((await ownedWork(prisma, a.owner, "TASK", a.task.id)).archivedAt, null);
  await assert.rejects(archiveWork(prisma, a.owner, "TASK", a.task.id, true), code("INVALID_STATE"));
});

test("embedded deadlines enforce cardinality, variants, target integrity and immediately reclassify", async () => {
  const a = await fixture(); const now = new Date("2026-10-15T12:00Z");
  for (const [kind, row] of [["TASK", a.task], ["PROJECT", a.project], ["ASSIGNMENT", a.assignment]] as const) {
    await changeDeadline(prisma, a.owner, kind, row.id, "CREATE", dateDeadline);
    await assert.rejects(changeDeadline(prisma, a.owner, kind, row.id, "CREATE", dateDeadline), code("CONFLICT"));
    for (const [dueDate, view] of [["2026-10-20", "UPCOMING"], ["2026-10-15", "TODAY"], ["2026-10-14", "OVERDUE"], ["2026-10-20", "UPCOMING"]] as const) {
      await changeDeadline(prisma, a.owner, kind, row.id, "UPDATE", { ...dateDeadline, dueDate });
      assert.ok((await queryWork(prisma, a.owner, { view, now, startDate: "2026-10-16", endDate: "2026-10-20", end: new Date("2026-10-21") })).some((result) => result.id === row.id));
    }
    await changeDeadline(prisma, a.owner, kind, row.id, "UPDATE", { deadlineKind: "TIMED", dueAt: "2026-10-15T11:00:00.123Z", dueTimezone: "UTC" });
    const deadline = await getDeadline(prisma, a.owner, kind, row.id);
    assert.equal(deadline.dueDate, null); assert.equal(deadline.dueAt?.toISOString(), "2026-10-15T11:00:00.123Z");
    await changeDeadline(prisma, a.owner, kind, row.id, "REMOVE");
    assert.deepEqual(await getDeadline(prisma, a.owner, kind, row.id), { deadlineKind: "NONE", dueDate: null, dueAt: null, dueTimezone: null });
    assert.ok(!(await queryWork(prisma, a.owner, { view: "OVERDUE", now })).some((result) => result.id === row.id));
    await assert.rejects(changeDeadline(prisma, a.owner, kind, row.id, "UPDATE", dateDeadline), code("INVALID_STATE"));
  }
  for (const input of [{ ...dateDeadline, dueDate: "2026-02-30" }, { ...dateDeadline, dueTimezone: "Bad/Zone" }, { ...dateDeadline, dueTimezone: "" }, { ...dateDeadline, dueAt: now.toISOString() }, { deadlineKind: "NONE", dueDate: "2026-10-15" }, { deadlineKind: "TIMED", dueAt: "2026-10-15T12:00", dueTimezone: "UTC" }, { deadlineKind: "TIMED", dueAt: "2026-02-30T12:00Z", dueTimezone: "UTC" }]) await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "Invalid deadline", ...input }), code("INVALID_INPUT"));
  await assert.rejects(changeDeadline(prisma, a.owner, "COURSE", a.course.id, "CREATE", dateDeadline), code("INVALID_INPUT"));
  await assert.rejects(createWork(prisma, a.owner, "TASK", { title: "   " }), code("INVALID_INPUT"));
  await assert.rejects(queryWork(prisma, a.owner, { view: "UPCOMING", startDate: "2026-10-20", endDate: "2026-10-01", end: new Date("2026-11-01") }), code("INVALID_INPUT"));
  await assert.rejects(queryWork(prisma, a.owner, { includeArchived: "nonsense" }), code("INVALID_INPUT"));
  await changeDeadline(prisma, a.owner, "TASK", a.task.id, "CREATE", { ...dateDeadline, dueDate: "2026-10-14" });
  await workLifecycle(prisma, a.owner, "TASK", a.task.id, "DONE");
  assert.ok(!(await queryWork(prisma, a.owner, { view: "OVERDUE", now })).some((row) => row.id === a.task.id));
  await workLifecycle(prisma, a.owner, "TASK", a.task.id, "TODO");
  assert.ok((await queryWork(prisma, a.owner, { view: "OVERDUE", now })).some((row) => row.id === a.task.id));
});

async function race(owner: { id: string }, operations: (() => Promise<unknown>)[]) {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const gate = withOwnerTransaction(prisma, owner.id, async () => { entered(); await held; });
  await ready;
  const observer = new Client({ connectionString: process.env.DATABASE_URL! }); await observer.connect();
  const pending: Promise<unknown>[] = [];
  try {
    for (const operation of operations) {
      pending.push(operation());
      const end = Date.now() + 3000; let waiting = 0;
      while (waiting < pending.length && Date.now() < end) waiting = Number((await observer.query<{ count: string }>("SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%public.app_user%'" )).rows[0]!.count);
      assert.equal(waiting, pending.length, "ordered mutations reached the real account gate");
    }
  } finally { release(); await observer.end(); }
  await gate; return Promise.allSettled(pending);
}
test("observed-lock races reject attachment after parent archive/terminal; retain prior relationships", async () => {
  for (const mode of ["projectArchive", "courseArchive", "termArchive", "projectTerminal", "courseTerminal", "termTerminal", "reassign"] as const) {
    const a = await fixture(); const standalone = await createWork(prisma, a.owner, "TASK", { title: "Standalone" });
    const first = () => mode === "projectArchive" || mode === "reassign" ? archiveWork(prisma, a.owner, "PROJECT", a.project.id, true) : mode === "courseArchive" ? archiveCourse(prisma, a.owner, a.course.id, true) : mode === "termArchive" ? archiveTerm(prisma, a.owner, a.term.id, true) : mode === "projectTerminal" ? workLifecycle(prisma, a.owner, "PROJECT", a.project.id, "COMPLETED") : mode === "courseTerminal" ? courseLifecycle(prisma, a.owner, a.course.id, "COMPLETED") : termLifecycle(prisma, a.owner, a.term.id, "CLOSED");
    const context = mode.startsWith("project") || mode === "reassign" ? { projectId: a.project.id } : { courseId: a.course.id };
    const result = await race(a.owner, [first, () => mode === "reassign" ? updateWork(prisma, a.owner, "TASK", standalone.id, { title: "Reassigned", ...context }) : createWork(prisma, a.owner, "TASK", { title: "New", ...context })]);
    assert.equal(result[0]!.status, "fulfilled"); assert.equal(result[1]!.status, "rejected");
    const attachment = result[1]!;
    if (attachment.status === "rejected") assert.ok(code("INVALID_STATE")(attachment.reason));
    const retained = await ownedWork(prisma, a.owner, "TASK", a.task.id);
    assert.ok("projectId" in retained && retained.projectId === a.project.id);
    assert.equal(retained.archivedAt, null); assert.equal(retained.status, "TODO");
  }
});
test("observed-lock deadline creation/update/completion races serialize one embedded variant", async () => {
  const a = await fixture();
  const duplicates = await race(a.owner, [() => changeDeadline(prisma, a.owner, "TASK", a.task.id, "CREATE", dateDeadline), () => changeDeadline(prisma, a.owner, "TASK", a.task.id, "CREATE", dateDeadline)]);
  assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
  for (const operation of ["REMOVE", "CREATE", "UPDATE"] as const) {
    const result = await race(a.owner, [() => workLifecycle(prisma, a.owner, "TASK", a.task.id, "DONE"), () => changeDeadline(prisma, a.owner, "TASK", a.task.id, operation, { ...dateDeadline, dueDate: "2026-10-14" })]);
    assert.ok(result.every((item) => item.status === "fulfilled"));
    assert.ok(!(await queryWork(prisma, a.owner, { view: "OVERDUE", now: new Date("2026-10-16") })).some((row) => row.id === a.task.id));
    await workLifecycle(prisma, a.owner, "TASK", a.task.id, "TODO");
  }
});
test("multi-model query retains one snapshot across an interleaved account transaction", async () => {
  const a = await fixture(); let interleaved = false;
  const intercepted = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, property) {
      if (property !== "task") return Reflect.get(transaction, property);
      return new Proxy(transaction.task, { get(delegate, method) {
        if (method !== "findMany") return Reflect.get(delegate, method);
        return async (args: object) => { const result = await delegate.findMany(args); if (!interleaved) { interleaved = true; await withOwnerTransaction(prisma, a.owner.id, async (write) => { await write.task.update({ where: { id: a.task.id }, data: { title: "After task" } }); await write.project.update({ where: { id: a.project.id }, data: { title: "After project" } }); }); } return result; };
      } });
    } })), options);
  } }) as PrismaClient;
  const rows = await queryWork(intercepted, a.owner);
  assert.equal(rows.find((row) => row.id === a.task.id)!.title, "Task");
  assert.equal(rows.find((row) => row.id === a.project.id)!.title, "Project");
  assert.equal((await ownedWork(prisma, a.owner, "PROJECT", a.project.id)).title, "After project");
});
