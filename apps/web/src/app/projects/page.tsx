import Link from 'next/link';
import { ApiError, ProjectForm, listProjects, projectDraftScope } from '@/features/projects';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
type Search = { searchParams: Promise<{ page?: string | string[] }> };
// The page number from the URL, or undefined when it is not a valid list page.
function pageNumber(page: string | string[] | undefined) {
  const value = page === undefined ? 1 : Number(page);
  return Array.isArray(page) || !Number.isInteger(value) || value < 1 || value > 401 ? undefined : value;
}
export async function generateMetadata({ searchParams }: Search): Promise<Metadata> {
  const page = pageNumber((await searchParams).page);
  if (page === undefined) return { title: 'Page not found' };
  return { title: page === 1 ? 'Projects' : `Projects, page ${page}` };
}
export default async function ProjectsPage({ searchParams }: Search) {
  const currentPage = pageNumber((await searchParams).page);
  if (currentPage === undefined) notFound();
  let projects;
  try {
    projects = await listProjects(currentPage);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return (
        <>
          <title>Sign in required · Projects reference</title>
          <h1>Sign in required</h1>
          {process.env.AUTH_MODE === 'oidc' ? (
            <a
              href={
                '/auth/login?returnTo=' +
                encodeURIComponent('/projects' + (currentPage > 1 ? '?page=' + currentPage : ''))
              }
            >
              Sign in
            </a>
          ) : (
            <p>Configure your identity-provider integration to sign in. No demo login is enabled.</p>
          )}
        </>
      );
    throw error;
  }
  const draftScope = await projectDraftScope();
  return (
    <>
      <h1>Projects</h1>
      {process.env.AUTH_MODE === 'oidc' && (
        <form action="/auth/logout" method="post">
          <button type="submit">Sign out</button>
        </form>
      )}
      <ProjectForm key={draftScope} draftScope={draftScope} />
      {projects.length === 0 ? (
        <p>No projects yet. Create your first project above.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={'/projects/' + project.id}>{project.name}</Link>
              <span>Version {project.version}</span>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Project pages">
        {currentPage > 1 && <Link href={'/projects?page=' + (currentPage - 1)}>Previous page</Link>}
        <span>Page {currentPage}</span>
        {projects.length === 25 && currentPage < 401 && (
          <Link href={'/projects?page=' + (currentPage + 1)}>Next page</Link>
        )}
      </nav>
    </>
  );
}
