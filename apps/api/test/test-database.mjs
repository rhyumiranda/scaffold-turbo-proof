// Loaded with `node --import` before every DB-backed suite. Those suites write rows and never
// clean up, so they refuse anything but a dedicated disposable database whose name ends in _test.
export function assertDisposableDatabase(env = process.env) {
  if (env.NODE_ENV !== 'test') throw new Error('DB-backed tests require NODE_ENV=test');
  if (!env.DATABASE_URL) throw new Error('DB-backed tests require DATABASE_URL for a dedicated disposable database');
  let name;
  try {
    name = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!/^[A-Za-z0-9_]+_test$/.test(name))
    throw new Error(
      `Refusing database "${name}": DB-backed tests write without cleanup, so the database name must end with _test`,
    );
  return name;
}
assertDisposableDatabase();
