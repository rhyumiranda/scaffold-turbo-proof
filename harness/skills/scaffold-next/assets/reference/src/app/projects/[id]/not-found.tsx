export const metadata = { title: 'Project not found' };
export default function NotFound() {
  return (
    <>
      <h1>Project not found</h1>
      <p>It may not exist or you may not have access.</p>
      <a href="/projects">Return to projects</a>
    </>
  );
}
