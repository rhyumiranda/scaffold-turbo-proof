'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// One delegated listener keeps project navigation inside the current tab without hydrating every project link.
export function ProjectNavigation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  useEffect(() => {
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
      const anchor = event.target.closest<HTMLAnchorElement>('a[data-project-navigation]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href);
      if (target.origin !== location.origin) return;
      event.preventDefault();
      setPending(true);
      router.push(target.pathname + target.search + target.hash);
    };
    document.addEventListener('click', navigate);
    return () => document.removeEventListener('click', navigate);
  }, [router]);
  if (!pending) return null;
  return (
    <span role="status" aria-live="polite">
      Loading…
    </span>
  );
}
