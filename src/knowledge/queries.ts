import type { PrismaClient } from "../generated/prisma/client";
import type { AcademicOwner } from "../academic/records";
import { idInput } from "../academic/validation";
import { knowledgeCourse } from "./service";
import { booleanInput, contextInput, invalid, knowledgeKind } from "./validation";
export async function queryKnowledge(prisma: PrismaClient, owner: AcademicOwner, target: unknown, input: Record<string, unknown> = {}) {
  const kind = knowledgeKind(target), ownerId = idInput(owner.id), courseId = contextInput(input);
  const view = input.view ?? "ACTIVE";
  if (view !== "ACTIVE" && view !== "MANAGEMENT") invalid("Choose ACTIVE or MANAGEMENT knowledge.");
  const archived = input.includeArchived === undefined ? false : booleanInput(input.includeArchived, "Include archived");
  if (archived && view !== "MANAGEMENT") invalid("Archived knowledge requires a management view.");
  return prisma.$transaction(async (tx) => {
    if (courseId) {
      const { eligible } = await knowledgeCourse(tx, owner, courseId);
      if (view === "ACTIVE" && !eligible) return [];
    }
    const where = { ownerId, ...(courseId === undefined ? {} : { courseId }), ...(!archived ? { archivedAt: null } : {}) };
    const orderBy = [{ updatedAt: "desc" as const }, { id: "asc" as const }];
    return kind === "NOTE" ? tx.note.findMany({ where, orderBy }) : tx.resource.findMany({ where, orderBy });
  }, { isolationLevel: "RepeatableRead" });
}
export async function knowledgeOptions(prisma: PrismaClient, owner: AcademicOwner) {
  return prisma.$transaction((tx) => tx.course.findMany({ where: { ownerId: idInput(owner.id) }, include: { term: true }, orderBy: [{ courseCode: "asc" }, { id: "asc" }] }), { isolationLevel: "RepeatableRead" });
}
