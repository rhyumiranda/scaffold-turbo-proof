export const metadata = { title: 'Signed out' };
export default function SignedOut() {
  return (
    <>
      <h1>Signed out</h1>
      <p>Your application session has ended.</p>
      <a href="/auth/login">Sign in again</a>
    </>
  );
}
