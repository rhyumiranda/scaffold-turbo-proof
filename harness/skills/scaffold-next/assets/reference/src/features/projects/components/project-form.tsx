'use client';
import { ProjectLink } from './project-link';
import { useProjectForm } from '../hooks/use-project-form';
import type { Project } from '../services/types';
export function ProjectForm({ project, draftScope }: { project?: Project; draftScope: string }) {
  const { state, submit, pending, input, signInHref, value, version, change } = useProjectForm(project, draftScope);
  return (
    <form action={submit} noValidate>
      <label htmlFor="project-name">Project name</label>
      <input
        ref={input}
        id="project-name"
        name="name"
        autoComplete="off"
        value={value}
        onChange={(event) => change(event.target.value)}
        aria-invalid={Boolean(state.fieldError)}
        aria-describedby={state.fieldError ? 'name-error' : undefined}
      />
      {project && <input type="hidden" name="expectedVersion" value={version} />}
      {state.fieldError && (
        <p id="name-error" className="error">
          {state.fieldError}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending && <span aria-hidden="true">◌ </span>}
        {project ? 'Save name' : 'Create project'}
      </button>
      <p role="status" aria-live="polite">
        {state.message}
      </p>
      {signInHref && (
        <a href={signInHref} target="_blank" rel="noopener">
          Sign in again (opens a new tab)
        </a>
      )}
      {state.createdId && <ProjectLink href={'/projects/' + state.createdId}>Open created project</ProjectLink>}
    </form>
  );
}
