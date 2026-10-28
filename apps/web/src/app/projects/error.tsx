'use client';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const router = useRouter();
  // The page's metadata <title> comes first in <head> and wins over a <title> rendered here, so the boundary sets
  // the document title while it is shown and gives the previous one back when a retry replaces it.
  useEffect(() => {
    const previous = document.title;
    document.title = 'Projects unavailable · Projects reference';
    return () => {
      document.title = previous;
    };
  }, []);
  // reset() alone re-renders the cached failed payload; refresh() refetches the server component first.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <>
      <h1>Projects unavailable</h1>
      <p>The service did not respond. Your data is safe; try again in a moment.</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </>
  );
}
