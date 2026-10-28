export declare class ConfigurationError extends Error {
  readonly variable: string;
  readonly reason: string;
  constructor(variable: string, reason: string);
}
export declare function validateRuntime(environment?: NodeJS.ProcessEnv): URL;
export declare function identitySettings(env?: NodeJS.ProcessEnv):
  | {
      origin: string;
      issuer: URL;
      redis: string;
      namespace: string;
      ttl: number;
      scope: string;
      insecure: boolean;
      clientId: string;
      clientSecret: string | undefined;
      sessionCookie: string;
      transactionCookie: string;
    }
  | undefined;
export declare function startServer(serverModule: string, environment?: NodeJS.ProcessEnv): Promise<void>;
