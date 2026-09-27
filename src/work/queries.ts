import { Temporal } from "@js-temporal/polyfill";
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { ownedCourse, type AcademicOwner } from "../academic/records";
import { academicDate } from "../academic/recurrence";
import { dateInput, idInput, literalDate } from "../academic/validation";
import { activeStatus, ownedWork } from "./service";
import { archiveInput, bad, workKind, type WorkKind } from "./validation";

export type WorkView = "ACTIVE" | "TODAY" | "DUE_ON" | "UPCOMING" | "OVERDUE" | "MANAGEMENT";
export type WorkQuery = { view?: WorkView; now?: Date; date?: unknown; startDate?: unknown; endDate?: unknown; start?: Date; end?: Date; courseId?: unknown; projectId?: unknown; kind?: unknown; includeArchived?: unknown };
export async function queryWork(prisma: PrismaClient, owner: AcademicOwner, query: WorkQuery = {}) {
  const ownerId = idInput(owner.id);
  const view = query.view ?? "ACTIVE";
  if (!["ACTIVE", "TODAY", "DUE_ON", "UPCOMING", "OVERDUE", "MANAGEMENT"].includes(view)) bad("Choose a valid work view.");
  const now = query.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) bad("Choose a valid current instant.");
  const kind = query.kind == null ? null : workKind(query.kind);
  const archived = query.includeArchived == null ? false : archiveInput(query.includeArchived);
  if (archived && view !== "MANAGEMENT") bad("Archived records are available only in management views.");
  const date = view === "DUE_ON" ? dateInput(query.date) : null;
  let startDate = "", endDate = "";
  let start = now, end = now;
  if (view === "UPCOMING") {
    startDate = dateInput(query.startDate); endDate = dateInput(query.endDate);
    const days = Temporal.PlainDate.from(startDate).until(Temporal.PlainDate.from(endDate)).days;
    if (days < 0 || days > 366) bad("Choose an inclusive future date window of at most 366 days.");
    start = query.start ?? now; end = query.end!;
    if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 366 * 86400000) bad("Choose a positive timed window of at most 366 days.");
  }
  return prisma.$transaction(async (tx) => {
    const course = query.courseId == null ? null : await ownedCourse(tx, owner, query.courseId);
    const project = query.projectId == null ? null : await ownedWork(tx, owner, "PROJECT", query.projectId);
    const term = course ? await tx.term.findFirst({ where: { id: course.termId, ownerId } }) : null;
    if (view !== "MANAGEMENT" && ((course && (course.archivedAt || !["UPCOMING", "ACTIVE"].includes(course.status) || !term || term.archivedAt || term.status === "CLOSED")) || (project && (project.archivedAt || !activeStatus("PROJECT", project.status))))) return [];
    // Bound upcoming candidates at the database; date-only windows stay literal dates.
    const temporal: Prisma.TaskWhereInput = view === "UPCOMING" ? { OR: [
      { deadlineKind: "DATE_ONLY", dueDate: { gte: new Date(`${startDate}T00:00:00Z`), lte: new Date(`${endDate}T00:00:00Z`) } },
      { deadlineKind: "TIMED", dueAt: { gte: new Date(Math.max(start.getTime(), now.getTime())), lt: end } },
    ] } : view === "TODAY" || view === "DUE_ON" || view === "OVERDUE" ? { deadlineKind: { not: "NONE" } } : {};
    const common = { ownerId, ...(!archived ? { archivedAt: null } : {}) };
    const tasks = kind && kind !== "TASK" ? [] : await tx.task.findMany({ where: { ...common, ...temporal, ...(view !== "MANAGEMENT" ? { status: { in: ["TODO", "IN_PROGRESS"] } } : {}), ...(project ? { projectId: project.id } : {}), ...(course ? { AND: [{ OR: [{ courseId: course.id }, { assignment: { courseId: course.id, ownerId } }] }] } : {}) } });
    const projects = kind && kind !== "PROJECT" ? [] : await tx.project.findMany({ where: { ...common, ...temporal as Prisma.ProjectWhereInput, ...(view !== "MANAGEMENT" ? { status: { in: ["PLANNED", "ACTIVE"] } } : {}), ...(project ? { id: project.id } : {}), ...(course ? { courseId: course.id } : {}) } });
    const assignments = (project || (kind && kind !== "ASSIGNMENT")) ? [] : await tx.assignment.findMany({ where: { ...common, ...temporal as Prisma.AssignmentWhereInput, ...(view !== "MANAGEMENT" ? { status: { in: ["NOT_STARTED", "IN_PROGRESS", "READY_TO_SUBMIT"] } } : {}), ...(course ? { courseId: course.id } : {}) } });
    const rows = [...tasks.map((row) => ({ ...row, kind: "TASK" as WorkKind })), ...projects.map((row) => ({ ...row, kind: "PROJECT" as WorkKind })), ...assignments.map((row) => ({ ...row, kind: "ASSIGNMENT" as WorkKind }))];
    return rows.filter((row) => {
      if (view === "ACTIVE" || view === "MANAGEMENT") return true;
      if (!row.dueTimezone || row.deadlineKind === "NONE") return false;
      const today = academicDate(now, row.dueTimezone);
      const due = row.dueDate ? literalDate(row.dueDate) : academicDate(row.dueAt!, row.dueTimezone);
      if (view === "TODAY") return due === today;
      if (view === "DUE_ON") return due === date;
      if (view === "OVERDUE") return row.deadlineKind === "DATE_ONLY" ? due < today : row.dueAt! < now;
      return row.deadlineKind === "DATE_ONLY" ? due > today && due >= startDate && due <= endDate : row.dueAt! >= now && row.dueAt! >= start && row.dueAt! < end;
    }).sort((a, b) => {
      // Mixed representations sort by their own calendar labels, then kind/instant/id.
      // This does not fabricate an instant for a date-only deadline.
      const key = (row: typeof a) => row.dueDate ? literalDate(row.dueDate) : row.dueAt ? academicDate(row.dueAt, row.dueTimezone!) : "9999-12-31";
      return key(a).localeCompare(key(b)) || a.deadlineKind.localeCompare(b.deadlineKind) || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
    });
  }, { isolationLevel: "RepeatableRead" });
}

export async function workOptions(prisma: PrismaClient, owner: AcademicOwner) {
  const ownerId = idInput(owner.id);
  return prisma.$transaction(async (tx) => ({
    terms: await tx.term.findMany({ where: { ownerId }, orderBy: { startsOn: "desc" } }),
    courses: await tx.course.findMany({ where: { ownerId }, include: { term: true }, orderBy: { courseCode: "asc" } }),
    projects: await tx.project.findMany({ where: { ownerId }, orderBy: { title: "asc" } }),
    assignments: await tx.assignment.findMany({ where: { ownerId }, include: { course: { include: { term: true } } }, orderBy: { title: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
