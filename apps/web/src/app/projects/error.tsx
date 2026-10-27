'use client';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const router = useRouter();
  // reset() alone re-renders the cached failed payload; refresh() refetches the server component first.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <>
      <title>Projects unavailable · Projects reference</title>
      <h1>Projects unavailable</h1>
      <p>The service did not respond. Your data is safe; try again in a moment.</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </>
  );
}
