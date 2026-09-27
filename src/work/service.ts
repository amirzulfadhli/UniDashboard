import type { PrismaClient } from "../generated/prisma/client";
import { mutation, ownedCourse, ownedTerm, type AcademicOwner, type AcademicTx } from "../academic/records";
import { idInput, literalDate } from "../academic/validation";
import { archiveInput, bad, deadlineInput, metadata, missing, optionalId, WorkError, workKind, type WorkKind } from "./validation";

export async function ownedWork(db: PrismaClient | AcademicTx, owner: AcademicOwner, kind: WorkKind, id: unknown) {
  const where = { ownerId: idInput(owner.id), id: idInput(id) };
  if (kind === "TASK") return await db.task.findFirst({ where }) ?? missing();
  if (kind === "PROJECT") return await db.project.findFirst({ where }) ?? missing();
  if (kind === "ASSIGNMENT") return await db.assignment.findFirst({ where }) ?? missing();
  return bad("Unsupported work target.");
}
async function termParent(tx: AcademicTx, owner: AcademicOwner, id: string, newlyAttached: boolean) {
  const term = await ownedTerm(tx, owner, id);
  if (newlyAttached && (term.archivedAt || term.status === "CLOSED")) throw new WorkError("INVALID_STATE", "New work requires a non-archived PLANNED or ACTIVE term.");
  return term;
}
async function courseParent(tx: AcademicTx, owner: AcademicOwner, id: string, newlyAttached: boolean) {
  const course = await ownedCourse(tx, owner, id);
  await termParent(tx, owner, course.termId, newlyAttached);
  if (newlyAttached && (course.archivedAt || (course.status !== "UPCOMING" && course.status !== "ACTIVE"))) throw new WorkError("INVALID_STATE", "New academic work requires a non-archived UPCOMING or ACTIVE course.");
  return course;
}
export function activeStatus(kind: WorkKind, status: string): boolean {
  return kind === "TASK" ? ["TODO", "IN_PROGRESS"].includes(status) : kind === "PROJECT" ? ["PLANNED", "ACTIVE"].includes(status) : ["NOT_STARTED", "IN_PROGRESS", "READY_TO_SUBMIT"].includes(status);
}
async function projectParent(tx: AcademicTx, owner: AcademicOwner, id: string, newlyAttached: boolean) {
  const project = await ownedWork(tx, owner, "PROJECT", id);
  if (newlyAttached && (project.archivedAt || !activeStatus("PROJECT", project.status))) throw new WorkError("INVALID_STATE", "New task attachment requires a non-archived PLANNED or ACTIVE project.");
}
export type WorkContext = { termId: string | null; courseId: string | null; assignmentId: string | null; projectId: string | null; homeTermId: string | null };
export function contextInput(input: Record<string, unknown>): WorkContext {
  return { termId: optionalId(input.termId), courseId: optionalId(input.courseId), assignmentId: optionalId(input.assignmentId), projectId: optionalId(input.projectId), homeTermId: optionalId(input.homeTermId) };
}
async function validateContext(tx: AcademicTx, owner: AcademicOwner, kind: WorkKind, context: WorkContext, previous?: object) {
  const changed = (key: keyof WorkContext) => !previous || (previous as Record<string, unknown>)[key] !== context[key];
  if (kind === "PROJECT") {
    if (context.termId || context.assignmentId || context.projectId || (context.courseId && context.homeTermId)) bad("Project context is Course, home Term, or standalone, never both.");
    if (context.courseId) await courseParent(tx, owner, context.courseId, changed("courseId"));
    if (context.homeTermId) await termParent(tx, owner, context.homeTermId, changed("homeTermId"));
  } else if (kind === "ASSIGNMENT") {
    if (!context.courseId || context.termId || context.homeTermId || context.assignmentId || context.projectId) bad("Assignments require exactly one Course context.");
    await courseParent(tx, owner, context.courseId, changed("courseId"));
  } else {
    if (context.homeTermId || (context.assignmentId && (context.courseId || context.termId)) || (context.courseId && (context.termId || context.projectId))) bad("Task context must follow the approved combinations; use Assignment + Project for organized academic work.");
    if (context.termId) await termParent(tx, owner, context.termId, changed("termId"));
    if (context.courseId) await courseParent(tx, owner, context.courseId, changed("courseId"));
    if (context.projectId) await projectParent(tx, owner, context.projectId, changed("projectId"));
    if (context.assignmentId) {
      const assignment = await tx.assignment.findFirst({ where: { ownerId: owner.id, id: context.assignmentId } }) ?? missing();
      await courseParent(tx, owner, assignment.courseId, changed("assignmentId"));
      if (changed("assignmentId") && (assignment.archivedAt || !activeStatus("ASSIGNMENT", assignment.status))) throw new WorkError("INVALID_STATE", "New task attachment requires an incomplete, non-archived Assignment.");
    }
  }
}
export async function createWork(prisma: PrismaClient, owner: AcademicOwner, target: unknown, input: Record<string, unknown>) {
  const kind = workKind(target); const data = metadata(input); const context = contextInput(input);
  const deadline = deadlineInput({ ...input, deadlineKind: input.deadlineKind ?? "NONE" });
  return mutation(prisma, owner, async (tx) => {
    await validateContext(tx, owner, kind, context);
    let record;
    if (kind === "TASK") record = await tx.task.create({ data: { ...data, ownerId: owner.id, termId: context.termId, courseId: context.courseId, assignmentId: context.assignmentId, projectId: context.projectId } });
    else if (kind === "PROJECT") record = await tx.project.create({ data: { ...data, ownerId: owner.id, courseId: context.courseId, homeTermId: context.homeTermId } });
    else record = await tx.assignment.create({ data: { ...data, ownerId: owner.id, courseId: context.courseId! } });
    await writeDeadline(tx, owner, kind, record.id, deadline);
    return ownedWork(tx, owner, kind, record.id);
  });
}
export async function updateWork(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, input: Record<string, unknown>) {
  const kind = workKind(target); const data = metadata(input); const context = contextInput(input);
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedWork(tx, owner, kind, id);
    await validateContext(tx, owner, kind, context, record);
    // All supported contexts are orthogonal; no transitive equality is invented.
    if (kind === "TASK") return tx.task.update({ where: { id: record.id }, data: { ...data, termId: context.termId, courseId: context.courseId, assignmentId: context.assignmentId, projectId: context.projectId } });
    if (kind === "PROJECT") return tx.project.update({ where: { id: record.id }, data: { ...data, courseId: context.courseId, homeTermId: context.homeTermId } });
    return tx.assignment.update({ where: { id: record.id }, data: { ...data, courseId: context.courseId! } });
  });
}
const statuses = { TASK: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"], PROJECT: ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"], ASSIGNMENT: ["NOT_STARTED", "IN_PROGRESS", "READY_TO_SUBMIT", "SUBMITTED", "GRADED", "CANCELLED"] };
export async function workLifecycle(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, status: unknown) {
  const kind = workKind(target);
  if (typeof status !== "string" || !statuses[kind].includes(status)) bad("Choose a valid work lifecycle state.");
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedWork(tx, owner, kind, id);
    if (record.status === status) return record;
    if (record.archivedAt && kind !== "PROJECT" && activeStatus(kind, status)) throw new WorkError("INVALID_STATE", "Restore this record before reopening it.");
    const now = new Date(Math.max(Date.now(), ...Object.entries(record).filter(([key, value]) => key.startsWith("last") && value instanceof Date).map(([, value]) => (value as Date).getTime())));
    const evidence: Record<string, Date> = { statusChangedAt: now };
    if (activeStatus(kind, status) && !activeStatus(kind, record.status)) evidence[record.status === "CANCELLED" ? "lastReinstatedAt" : "lastReopenedAt"] = now;
    if (status === "CANCELLED") evidence.lastCancelledAt = now;
    if (status === "DONE" || status === "COMPLETED") evidence.lastCompletedAt = now;
    if (kind === "PROJECT" && status === "ACTIVE" && record.status === "PLANNED") evidence.lastActivatedAt = now;
    if (status === "SUBMITTED") evidence.lastSubmittedAt = now;
    if (status === "GRADED") {
      evidence.lastGradedAt = now;
      if (!("lastSubmittedAt" in record) || !record.lastSubmittedAt) evidence.lastSubmittedAt = now;
    }
    if (kind === "TASK") return tx.task.update({ where: { id: record.id }, data: { ...evidence, status: status as "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" } });
    if (kind === "PROJECT") return tx.project.update({ where: { id: record.id }, data: { ...evidence, status: status as "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED" } });
    return tx.assignment.update({ where: { id: record.id }, data: { ...evidence, status: status as "NOT_STARTED" | "IN_PROGRESS" | "READY_TO_SUBMIT" | "SUBMITTED" | "GRADED" | "CANCELLED" } });
  });
}
export async function archiveWork(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, value: unknown) {
  const kind = workKind(target); const archived = archiveInput(value);
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedWork(tx, owner, kind, id);
    if (archived && kind !== "PROJECT" && activeStatus(kind, record.status)) throw new WorkError("INVALID_STATE", "Complete, submit, or cancel this work before archiving it.");
    const data = { archivedAt: archived ? record.archivedAt ?? new Date() : null };
    if (kind === "TASK") return tx.task.update({ where: { id: record.id }, data });
    if (kind === "PROJECT") return tx.project.update({ where: { id: record.id }, data });
    return tx.assignment.update({ where: { id: record.id }, data });
  });
}
async function writeDeadline(tx: AcademicTx, owner: AcademicOwner, kind: WorkKind, id: string, deadline: ReturnType<typeof deadlineInput>) {
  const { deadlineKind, dueDate, dueAt, dueTimezone } = deadline;
  if (kind === "TASK") await tx.$executeRaw`UPDATE public.task SET deadline_kind=${deadlineKind}::"DeadlineKind",due_date=${dueDate}::date,due_at=${dueAt}::timestamptz,due_timezone=${dueTimezone} WHERE id=${id}::uuid AND owner_id=${owner.id}::uuid`;
  else if (kind === "PROJECT") await tx.$executeRaw`UPDATE public.project SET deadline_kind=${deadlineKind}::"DeadlineKind",due_date=${dueDate}::date,due_at=${dueAt}::timestamptz,due_timezone=${dueTimezone} WHERE id=${id}::uuid AND owner_id=${owner.id}::uuid`;
  else await tx.$executeRaw`UPDATE public.assignment SET deadline_kind=${deadlineKind}::"DeadlineKind",due_date=${dueDate}::date,due_at=${dueAt}::timestamptz,due_timezone=${dueTimezone} WHERE id=${id}::uuid AND owner_id=${owner.id}::uuid`;
}
export async function getDeadline(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown) {
  const record = await ownedWork(prisma, owner, workKind(target), id);
  return { deadlineKind: record.deadlineKind, dueDate: record.dueDate ? literalDate(record.dueDate) : null, dueAt: record.dueAt, dueTimezone: record.dueTimezone };
}
export async function changeDeadline(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, operation: unknown, input: Record<string, unknown> = {}) {
  const kind = workKind(target);
  if (operation !== "CREATE" && operation !== "UPDATE" && operation !== "REMOVE") bad("Choose CREATE, UPDATE, or REMOVE deadline.");
  const deadline = deadlineInput(operation === "REMOVE" ? { deadlineKind: "NONE" } : input);
  if (operation !== "REMOVE" && deadline.deadlineKind === "NONE") bad("Use REMOVE to clear the deadline.");
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedWork(tx, owner, kind, id);
    if (operation === "CREATE" && record.deadlineKind !== "NONE") throw new WorkError("CONFLICT", "This work item already has a deadline. Edit it instead.");
    if (operation === "UPDATE" && record.deadlineKind === "NONE") throw new WorkError("INVALID_STATE", "Create a deadline first.");
    await writeDeadline(tx, owner, kind, record.id, deadline);
    return ownedWork(tx, owner, kind, record.id);
  });
}
