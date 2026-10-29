'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { createAction, renameAction } from '../actions/projects';
import { preflightSession } from '../services/session.browser';
import type { MutationState, Project } from '../services/types';
type Draft = { value: string; baseline: string; version: number; revision: number };
// Tab-memory only: never serialize private drafts into URLs, history or browser storage.
const drafts = new Map<string, Draft>();
let activeScope = '';
// The hook owns the mutation: client components never import, receive or bind a Server Action.
export function useProjectForm(project: Project | undefined, scope: string) {
  const id = project?.id ?? 'create',
    name = project?.name ?? '',
    version = project?.version ?? 1,
    returnTo = project ? '/projects/' + project.id : '/projects';
  const action: (previous: MutationState, form: FormData) => Promise<MutationState> = project
    ? renameAction.bind(null, project.id)
    : createAction;
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window !== 'undefined') {
      if (activeScope !== scope) {
        drafts.clear();
        activeScope = scope;
      }
      const saved = drafts.get(id);
      if (saved) return saved;
    }
    return { value: name, baseline: name, version, revision: 0 };
  });
  const current = useRef(draft),
    mounted = useRef(true);
  function update(next: Draft) {
    current.current = next;
    setDraft(next);
    if (activeScope === scope) {
      if (next.value === next.baseline) drafts.delete(id);
      else drafts.set(id, next);
    }
  }
  const [state, submit, pending] = useActionState(
    async (previous: MutationState, form: FormData) => {
      const submitted = current.current;
      if ((await preflightSession()) === 'expired')
        return {
          status: 'error',
          message: 'Your session expired. Sign in again, then save here; your input has been kept.',
          needsSignIn: true,
        } satisfies MutationState;
      const result = await action(previous, form);
      if (mounted.current && activeScope === scope && result.status === 'success') {
        const latest = current.current,
          baseline = result.inputValue ?? '';
        update({
          ...latest,
          baseline,
          version: result.savedVersion ?? latest.version,
          value: latest.revision === submitted.revision ? baseline : latest.value,
        });
      }
      return result;
    },
    { status: 'idle', message: '' },
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.fieldError) input.current?.focus();
  }, [state]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = draft.value !== draft.baseline;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search
      )
        return;
      if (!window.confirm('Discard unsaved changes?')) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        drafts.delete(id);
        current.current = {
          ...current.current,
          value: current.current.baseline,
          revision: current.current.revision + 1,
        };
      }
    };
    if (dirty) {
      window.addEventListener('beforeunload', warn);
      document.addEventListener('click', navigate, true);
    }
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, id]);
  return {
    state,
    submit,
    pending,
    input,
    value: draft.value,
    version: draft.version,
    signInHref: '/auth/login?returnTo=' + encodeURIComponent(returnTo),
    change: (value: string) => update({ ...current.current, value, revision: current.current.revision + 1 }),
  };
}
