export const metadata = { title: 'Sign-in problem' };
const messages = {
  unavailable: 'The sign-in service is not responding. Nothing was lost; try again in a moment.',
  rejected: 'That sign-in attempt could not be completed. It may have expired or been opened twice. Start again.',
};
export default async function SignInProblem({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const reason = (await searchParams).reason === 'unavailable' ? 'unavailable' : 'rejected';
  return (
    <>
      <h1>Sign-in problem</h1>
      <p role="alert">{messages[reason]}</p>
      <p>
        <a href="/auth/login">Try signing in again</a> or <a href="/">go to the home page</a>.
      </p>
    </>
  );
}
