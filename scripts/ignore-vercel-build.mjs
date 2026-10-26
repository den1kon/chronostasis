import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Reserve Integration preparation for an owner-triggered redeploy that bypasses
// Vercel's ignore step; ordinary Preview and Production builds may proceed.
export function shouldIgnoreDeployment(env) {
  return (
    env['VERCEL_ENV'] === 'preview' &&
    env['VERCEL_GIT_COMMIT_REF'] === 'integration'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  // Vercel uses exit 0 to cancel the build and exit 1 to continue it.
  process.exitCode = shouldIgnoreDeployment(process.env) ? 0 : 1;
}
