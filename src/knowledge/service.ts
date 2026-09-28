import type { PrismaClient } from "../generated/prisma/client";
import { AcademicError, notFound } from "../academic/errors";
import { idInput } from "../academic/validation";
import { mutation, ownedCourse, ownedTerm, type AcademicOwner, type AcademicTx } from "../academic/records";
import { booleanInput, contentInput, contextInput, invalid, knowledgeKind, noteInput, noteMetadataInput, resourceInput } from "./validation";

export async function ownedKnowledge(db: PrismaClient | AcademicTx, owner: AcademicOwner, target: unknown, id: unknown) {
  const kind = knowledgeKind(target), where = { id: idInput(id), ownerId: idInput(owner.id) };
  return (kind === "NOTE" ? await db.note.findFirst({ where }) : await db.resource.findFirst({ where })) ?? notFound();
}
export async function knowledgeCourse(db: AcademicTx, owner: AcademicOwner, id: string) {
  const course = await ownedCourse(db, owner, id);
  const term = await ownedTerm(db, owner, course.termId);
  return { course, eligible: !course.archivedAt && ["UPCOMING", "ACTIVE"].includes(course.status) && !term.archivedAt && ["PLANNED", "ACTIVE"].includes(term.status) };
}
async function validateAttachment(tx: AcademicTx, owner: AcademicOwner, courseId: string | null, previous?: string | null) {
  if (!courseId) return;
  const { eligible } = await knowledgeCourse(tx, owner, courseId);
  if (courseId !== previous && !eligible) throw new AcademicError("INVALID_STATE", "New knowledge attachment requires an eligible, non-archived Course and Term.");
}
export async function createKnowledge(prisma: PrismaClient, owner: AcademicOwner, target: unknown, input: Record<string, unknown>) {
  const kind = knowledgeKind(target), courseId = contextInput(input) ?? null;
  return mutation(prisma, owner, async (tx) => {
    await validateAttachment(tx, owner, courseId);
    if (kind === "NOTE") return tx.note.create({ data: { ...noteInput(input), ownerId: owner.id, courseId } });
    return tx.resource.create({ data: { ...resourceInput(input), ownerId: owner.id, courseId } });
  });
}
export async function updateKnowledge(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, input: Record<string, unknown>) {
  const kind = knowledgeKind(target), context = contextInput(input);
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedKnowledge(tx, owner, kind, id);
    const courseId = context === undefined ? record.courseId : context;
    await validateAttachment(tx, owner, courseId, record.courseId);
    if (kind === "NOTE") return tx.note.update({ where: { id: record.id, ownerId: owner.id }, data: { ...noteMetadataInput(input), ...(input.contentMarkdown === undefined ? {} : { contentMarkdown: contentInput(input.contentMarkdown) }), courseId } });
    return tx.resource.update({ where: { id: record.id, ownerId: owner.id }, data: { ...resourceInput(input), courseId } });
  });
}
export async function updateNoteMetadata(prisma: PrismaClient, owner: AcademicOwner, id: unknown, input: Record<string, unknown>) {
  if (Object.hasOwn(input, "contentMarkdown")) invalid("Use the content editor to change Note content.");
  return updateKnowledge(prisma, owner, "NOTE", id, input);
}
export async function updateNoteContent(prisma: PrismaClient, owner: AcademicOwner, id: unknown, content: unknown) {
  const contentMarkdown = contentInput(content);
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedKnowledge(tx, owner, "NOTE", id);
    return tx.note.update({ where: { id: record.id, ownerId: owner.id }, data: { contentMarkdown } });
  });
}
export async function archiveKnowledge(prisma: PrismaClient, owner: AcademicOwner, target: unknown, id: unknown, value: unknown) {
  const kind = knowledgeKind(target), archived = booleanInput(value, "Archive");
  return mutation(prisma, owner, async (tx) => {
    const record = await ownedKnowledge(tx, owner, kind, id);
    const data = { archivedAt: archived ? record.archivedAt ?? new Date() : null };
    if (kind === "NOTE") return tx.note.update({ where: { id: record.id, ownerId: owner.id }, data });
    return tx.resource.update({ where: { id: record.id, ownerId: owner.id }, data });
  });
}
