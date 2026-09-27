/** Server configuration only. Never import this module into a client component. */
export type AuthConfiguration = Readonly<{ secret: string; baseURL: string }>;
type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

// Keep the public .env.example marker rejected, including when copied verbatim.
const publicSecrets = new Set([
  "replace-with-a-unique-random-secret-at-least-32-bytes",
  "better-auth-secret-12345678901234567890",
]);

export function loadAuthConfiguration(env: AuthEnvironment = process.env): AuthConfiguration {
  // Pinned Better Auth gives its rotation environment setting priority over secret.
  // UniOS Task 2 supports one explicit secret, so reject that alternate source.
  if (env.BETTER_AUTH_SECRETS?.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRETS is unsupported; configure BETTER_AUTH_SECRET only.");
  }
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || !secret.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRET must be explicitly configured.");
  }
  if (publicSecrets.has(secret.trim())) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRET must be replaced with a private random value.");
  }
  // Better Auth 1.7.6 recommends >=32 characters. Do not count padding.
  if (secret.trim().length < 32) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRET must contain at least 32 non-padding characters.");
  }

  const input = env.BETTER_AUTH_URL?.trim();
  if (!input) throw new AuthConfigurationError("BETTER_AUTH_URL must be explicitly configured.");
  if (!/^https?:\/\/[^/?#@]+\/?$/i.test(input) || /[\s\\]/.test(input)) {
    throw new AuthConfigurationError("BETTER_AUTH_URL must be an absolute HTTP or HTTPS origin.");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AuthConfigurationError("BETTER_AUTH_URL must be an absolute HTTP or HTTPS origin.");
  }
  if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AuthConfigurationError("BETTER_AUTH_URL must be an origin without credentials, path, query, or fragment.");
  }
  return Object.freeze({ secret, baseURL: url.origin });
}
