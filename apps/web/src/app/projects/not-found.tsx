import Link from 'next/link';
export const metadata = { title: 'Not found' };
export default function NotFound() {
  return (
    <>
      <h1>Project not found</h1>
      <p>It may not exist or you may not have access.</p>
      <Link href="/projects">Return to projects</Link>
    </>
  );
}
