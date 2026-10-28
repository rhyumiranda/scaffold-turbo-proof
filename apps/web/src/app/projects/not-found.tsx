import Link from 'next/link';
export const metadata = { title: 'Page not found' };
export default function ProjectsNotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>That list page does not exist.</p>
      <Link href="/projects">Go to the first page of projects</Link>
    </>
  );
}
