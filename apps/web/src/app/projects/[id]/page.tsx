import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ApiError, ProjectForm, readProject, projectDraftScope, ProjectLink } from '@/features/projects';
import type { Metadata } from 'next';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return { title: 'Project not found' };
  try {
    return { title: (await readProject(id)).name };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { title: 'Project not found' };
    if (error instanceof ApiError && error.status === 401) return { title: 'Sign in required' };
    return { title: 'Project unavailable' };
  }
}
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let project;
  try {
    project = await readProject(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401)
      return (
        <>
          <h1>Sign in required</h1>
          {process.env.AUTH_MODE === 'oidc' ? (
            <a href={'/auth/login?returnTo=' + encodeURIComponent('/projects/' + id)}>Sign in</a>
          ) : (
            <ProjectLink href="/projects">Return to projects</ProjectLink>
          )}
        </>
      );
    throw error;
  }
  const draftScope = await projectDraftScope();
  return (
    <>
      <ProjectLink href="/projects">All projects</ProjectLink>
      <h1>{project.name}</h1>
      <ProjectForm key={draftScope + id} draftScope={draftScope} project={project} />
    </>
  );
}
