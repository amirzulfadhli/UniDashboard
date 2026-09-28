"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AcademicError } from "../academic/errors";
import { getPrisma } from "../auth/db";
import { archiveKnowledge, createKnowledge, updateKnowledge, updateNoteContent, updateNoteMetadata } from "../knowledge/service";
import { invalid } from "../knowledge/validation";
import { requirePageUser } from "./protected-user";
async function save(form: FormData, write: (owner: Awaited<ReturnType<typeof requirePageUser>>) => Promise<unknown>) {
  const owner = await requirePageUser(); let message: string | null = null;
  try { await write(owner); } catch (error) { message = error instanceof AcademicError ? error.message : "Unable to save this knowledge change. Please retry."; }
  revalidatePath("/notes"); revalidatePath("/resources");
  const destination = form.get("kind") === "RESOURCE" ? "/resources" : "/notes";
  redirect(`${destination}?view=MANAGEMENT${message ? `&error=${encodeURIComponent(message)}` : ""}`);
}
export async function createKnowledgeAction(form: FormData) { await save(form, (owner) => createKnowledge(getPrisma(), owner, form.get("kind"), Object.fromEntries(form))); }
export async function updateKnowledgeAction(form: FormData) { await save(form, (owner) => form.get("kind") === "NOTE" ? updateNoteMetadata(getPrisma(), owner, form.get("id"), Object.fromEntries(form)) : updateKnowledge(getPrisma(), owner, form.get("kind"), form.get("id"), Object.fromEntries(form))); }
export async function updateNoteContentAction(form: FormData) { await save(form, (owner) => {
  if (form.get("kind") !== "NOTE") invalid("Choose Note content to edit.");
  return updateNoteContent(getPrisma(), owner, form.get("id"), form.get("contentMarkdown"));
}); }
export async function archiveKnowledgeAction(form: FormData) { await save(form, (owner) => archiveKnowledge(getPrisma(), owner, form.get("kind"), form.get("id"), form.get("archived"))); }
