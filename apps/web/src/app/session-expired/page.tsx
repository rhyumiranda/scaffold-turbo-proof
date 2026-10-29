import Link from 'next/link';
import { safeReturnTo } from '@/lib/safe-return-to.mjs';
export const metadata = { title: 'Session expired' };
export default async function SessionExpired({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo, process.env.AUTH_APP_ORIGIN!);
  return (
    <>
      <h1>Session expired</h1>
      <p>Your save was refused. Your draft is still in this tab.</p>
      <p>
        <a href={'/auth/login?returnTo=' + encodeURIComponent(returnTo)} target="_blank" rel="noopener">
          Sign in again (opens a new tab)
        </a>
      </p>
      <Link href={returnTo}>Return to your draft</Link>
    </>
  );
}
