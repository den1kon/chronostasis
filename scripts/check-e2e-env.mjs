const clerkSettings = [
  'VITE_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_ISSUER',
  'CLERK_AUTHORIZED_PARTIES',
];

export function missingE2eSettings(environment, mode = 'authenticated') {
  const required = mode === 'signed-out' ? clerkSettings : [...clerkSettings, 'E2E_CLERK_USER_EMAIL'];
  return required.filter((name) => !environment[name]?.trim());
}

const signedOutOnly = process.argv[2] === '--signed-out' && process.argv.length === 3;
const unexpectedArgument = process.argv.length > 2 && !signedOutOnly;
if (unexpectedArgument) {
  console.error('Usage: node scripts/check-e2e-env.mjs [--signed-out]');
  process.exitCode = 2;
} else {
  const missing = missingE2eSettings(process.env, signedOutOnly ? 'signed-out' : 'authenticated');
  if (missing.length > 0) {
    console.error(`E2E configuration is incomplete. Set: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
}
