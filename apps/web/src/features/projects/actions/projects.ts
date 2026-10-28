'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ApiError, createProject, renameProject } from '../services/projects.server';
import { nameSchema, type MutationState } from '../services/types';
const oidc = process.env.AUTH_MODE === 'oidc';
// Every failure is shown next to the field (and announced), so the user always sees what to do with their input.
function failure(error: unknown): MutationState {
  const status = error instanceof ApiError ? error.status : 500;
  const known: Record<number, string> = {
    401: oidc
      ? 'Your session expired. Sign in again in a new tab, then save here; your input has been kept.'
      : 'Your session expired. Sign in again, then save here; your input has been kept.',
    404: 'Project not found.',
    409: 'This project changed since you opened it. Reload the page, then save again.',
    429: 'Too many requests. Wait a moment, then try again.',
  };
  // A timeout or server error after sending may still have saved: say so, so the user checks before resubmitting.
  const message =
    known[status] ??
    'The service did not confirm the save. It may have been saved: reload before trying again. Your input has been kept.';
  return { status: 'error', message, fieldError: message, ...(status === 401 && oidc ? { signIn: true } : {}) };
}
// Only the fields this action reads (plus Next.js's own $ACTION_* fields) are accepted.
function unexpectedField(form: FormData, allowed: string[]) {
  return [...form.keys()].find((key) => !key.startsWith('$ACTION') && !allowed.includes(key));
}
// Server Actions are public endpoints: a crafted request can send any serialisable value, not only a form.
const notAForm: MutationState = { status: 'error', message: 'Invalid submission.', fieldError: 'Invalid submission.' };
export async function createAction(_previous: MutationState, form: FormData): Promise<MutationState> {
  if (!(form instanceof FormData)) return notAForm;
  const inputValue = String(form.get('name') ?? '').slice(0, 1000);
  if (unexpectedField(form, ['name']))
    return { status: 'error', message: 'Unexpected form field.', fieldError: 'Unexpected form field.', inputValue };
  const parsed = nameSchema.safeParse(form.get('name'));
  if (!parsed.success)
    return {
      status: 'error',
      message: 'Check the project name.',
      fieldError: parsed.error.issues[0]?.message ?? 'Invalid name.',
      inputValue,
    };
  let created;
  try {
    created = await createProject(parsed.data);
  } catch (error) {
    return { ...failure(error), inputValue };
  }
  revalidatePath('/projects');
  return { status: 'success', message: 'Project created.', inputValue: '', createdId: created.id };
}
export async function renameAction(id: string, _previous: MutationState, form: FormData): Promise<MutationState> {
  if (!(form instanceof FormData) || typeof id !== 'string') return notAForm;
  const inputValue = String(form.get('name') ?? '').slice(0, 1000);
  if (unexpectedField(form, ['name', 'expectedVersion']))
    return { status: 'error', message: 'Unexpected form field.', fieldError: 'Unexpected form field.', inputValue };
  const parsed = z
    .object({ id: z.uuid(), name: nameSchema, expectedVersion: z.coerce.number().int().positive().max(2147483647) })
    .safeParse({
      id,
      name: form.get('name'),
      expectedVersion: form.get('expectedVersion'),
    });
  if (!parsed.success)
    return {
      status: 'error',
      message: 'Check the form.',
      fieldError: parsed.error.issues[0]?.message ?? 'Invalid input.',
      inputValue,
    };
  let saved;
  try {
    saved = await renameProject(parsed.data.id, parsed.data.name, parsed.data.expectedVersion);
  } catch (error) {
    return { ...failure(error), inputValue };
  }
  revalidatePath('/projects');
  revalidatePath('/projects/' + parsed.data.id);
  return { status: 'success', message: 'Project renamed.', inputValue: saved.name, savedVersion: saved.version };
}
