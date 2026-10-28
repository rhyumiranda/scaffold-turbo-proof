import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Projects reference', template: '%s · Projects reference' },
  robots: { index: false, follow: false },
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <main id="content">{children}</main>
      </body>
    </html>
  );
}
