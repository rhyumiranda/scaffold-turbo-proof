// The only place shared platform code names the first feature. Replacing the Projects example means editing this
// file, not proxy.ts, identity.ts or the telemetry filters. See docs/replacing-the-example.md.

// Where a signed-in user lands, and where sign-in returns when no safe return path was given.
export const homePath = '/projects';
// Pages that need a session. In OIDC mode the proxy redirects to sign-in before rendering them.
export const privatePaths = [/^\/projects(\/|$)/];
// Operation names allowed in request logs and trace spans. Fixed names keep user data out of telemetry.
export const operations = ['projects.list', 'projects.read', 'projects.create', 'projects.rename'];
