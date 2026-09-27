"use server";

import { redirect } from "next/navigation";
import { requireCurrentUser, UnauthenticatedError } from "../../auth/current-user";
import { getPrisma } from "../../auth/db";
import { completeFirstTerm, saveProfile, saveProgramme } from "../../onboarding/service";
import { OnboardingValidationError } from "../../onboarding/validation";

export type ActionState = { error: string | null };

async function owner() {
  try {
    return await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    throw error;
  }
}

export async function saveProfileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await owner();
  try {
    await saveProfile(getPrisma(), currentUser, {
      displayName: formData.get("displayName"),
      timezone: formData.get("timezone"),
    });
  } catch (error) {
    if (error instanceof OnboardingValidationError) return { error: error.message };
    throw error;
  }
  redirect("/onboarding?step=programme");
}

export async function saveProgrammeAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await owner();
  try {
    await saveProgramme(getPrisma(), currentUser, {
      name: formData.get("name"),
      description: formData.get("description"),
    });
  } catch (error) {
    if (error instanceof OnboardingValidationError) return { error: error.message };
    throw error;
  }
  redirect("/onboarding?step=term");
}

export async function skipProgrammeAction(): Promise<void> {
  await owner();
  redirect("/onboarding?step=term");
}

export async function completeTermAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await owner();
  try {
    await completeFirstTerm(getPrisma(), currentUser, {
      name: formData.get("name"),
      academicTimezone: formData.get("academicTimezone"),
      startsOn: formData.get("startsOn"),
      endsOn: formData.get("endsOn"),
      teachingStartsOn: formData.get("teachingStartsOn"),
    });
  } catch (error) {
    if (error instanceof OnboardingValidationError) return { error: error.message };
    throw error;
  }
  redirect("/home");
}
