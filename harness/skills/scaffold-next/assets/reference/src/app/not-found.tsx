import { homePath } from '@/lib/feature-routes.mjs';
export const metadata = { title: 'Not found' };
export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>Check the address, or go back to the start page.</p>
      <a href={homePath}>Go to the start page</a>
    </>
  );
}
