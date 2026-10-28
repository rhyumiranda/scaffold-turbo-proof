'use client';
import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';
// Shown while this link's navigation is in flight, so a click always gives feedback even before the next page's
// loading state has been prefetched.
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span role="status"> Loading…</span> : null;
}
export function ProjectLink({ children, prefetch = false, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} prefetch={prefetch}>
      {children}
      <Pending />
    </Link>
  );
}
