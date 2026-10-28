// Thrown for invalid settings. The message names the variable and the rule, never the value,
// so it is safe to log and print at startup.
export class ConfigurationError extends Error {
  constructor(
    readonly variable: string,
    readonly reason: string,
  ) {
    super(`${variable}: ${reason}`);
  }
}
export function parseUrl(variable: string, value: string | undefined): URL {
  if (!value) throw new ConfigurationError(variable, 'missing');
  try {
    return new URL(value);
  } catch {
    throw new ConfigurationError(variable, 'must be an absolute URL');
  }
}
