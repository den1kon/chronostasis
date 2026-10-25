export interface ApiEnv {
  clerkSecretKey: string;
  clerkIssuer: string;
  authorizedParties: string[];
  host: string;
  port: number;
}
type Environment = Readonly<Record<string, string | undefined>>;
function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function origin(value: string, name: string, httpsOnly = false): string {
  try {
    const url = new URL(value);
    if (
      !(httpsOnly
        ? url.protocol === 'https:'
        : ['http:', 'https:'].includes(url.protocol)) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid origin');
    return url.origin;
  } catch {
    throw new Error(`${name} must contain valid origins.`);
  }
}
export function readApiEnv(env: Environment): ApiEnv {
  const clerkSecretKey = required(env, 'CLERK_SECRET_KEY');
  const clerkIssuer = origin(
    required(env, 'CLERK_ISSUER'),
    'CLERK_ISSUER',
    true,
  );
  const authorizedParties = [
    ...new Set(
      required(env, 'CLERK_AUTHORIZED_PARTIES')
        .split(',')
        .map(value => origin(value.trim(), 'CLERK_AUTHORIZED_PARTIES')),
    ),
  ];
  const host = env['API_HOST']?.trim() ?? '127.0.0.1';
  if (!host) throw new Error('API_HOST must not be empty.');
  const port = Number(env['API_PORT'] ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('API_PORT must be an integer from 1 to 65535.');
  return {clerkSecretKey, clerkIssuer, authorizedParties, host, port};
}
