import { z } from 'zod';
import type { components } from '@repo/api-client';
export type Project = components['schemas']['ProjectResponse'];
export type RenamedProject = components['schemas']['RenamedProjectResponse'];
export const projectSchema: z.ZodType<Project> = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const projectsSchema = z.array(projectSchema);
export const renamedProjectSchema: z.ZodType<RenamedProject> = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  version: z.number().int().min(2),
});
export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a project name.')
  .max(100, 'Use 100 characters or fewer.')
  .refine((value) => !value.includes('\u0000'), 'Remove the null character from the name.');
export type MutationState = {
  status: 'idle' | 'error' | 'success';
  message: string;
  fieldError?: string;
  inputValue?: string;
  createdId?: string;
  savedVersion?: number;
};
