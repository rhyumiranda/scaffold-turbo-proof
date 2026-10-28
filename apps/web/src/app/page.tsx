import { redirect } from 'next/navigation';
import { homePath } from '@/lib/feature-routes.mjs';
export default function Home() {
  redirect(homePath);
}
