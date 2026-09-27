"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AcademicError } from "../academic/errors";
import { getPrisma } from "../auth/db";
import { archiveWork, changeDeadline, createWork, updateWork, workLifecycle } from "../work/service";
import { requirePageUser } from "./protected-user";

async function save(form: FormData, write: (owner: Awaited<ReturnType<typeof requirePageUser>>) => Promise<unknown>) {
  const owner = await requirePageUser();
  let message: string | null = null;
  try { await write(owner); } catch (error) { message = error instanceof AcademicError ? error.message : "Unable to save this work change. Please retry."; }
  for (const path of ["/work", "/projects", "/courses"]) revalidatePath(path);
  const destination = form.get("returnTo") === "/projects" ? "/projects" : "/work?view=MANAGEMENT";
  redirect(message ? `${destination}${destination.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}` : destination);
}
export async function createWorkAction(form: FormData) { await save(form, (owner) => createWork(getPrisma(), owner, form.get("kind"), Object.fromEntries(form))); }
export async function updateWorkAction(form: FormData) { await save(form, (owner) => updateWork(getPrisma(), owner, form.get("kind"), form.get("id"), Object.fromEntries(form))); }
export async function workLifecycleAction(form: FormData) { await save(form, (owner) => workLifecycle(getPrisma(), owner, form.get("kind"), form.get("id"), form.get("status"))); }
export async function archiveWorkAction(form: FormData) { await save(form, (owner) => archiveWork(getPrisma(), owner, form.get("kind"), form.get("id"), form.get("archived"))); }
export async function deadlineAction(form: FormData) { await save(form, (owner) => changeDeadline(getPrisma(), owner, form.get("kind"), form.get("id"), form.get("operation"), Object.fromEntries(form))); }
