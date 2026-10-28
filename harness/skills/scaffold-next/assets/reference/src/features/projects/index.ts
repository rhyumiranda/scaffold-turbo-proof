// Public surface of the projects feature. Routes and other features import only from here.
// It re-exports server-only reads, so a client file importing it fails `npm run check:arch`.
export { ApiError, listProjects, readProject, projectDraftScope } from './services/projects.server';
export { ProjectForm } from './components/project-form';
export type { Project } from './services/types';
