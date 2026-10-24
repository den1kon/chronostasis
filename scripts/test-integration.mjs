import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Each invocation owns its containers/volumes; cleanup cannot target the normal
// development project or another concurrently running integration suite.
const project = `chronostasis-test-${randomUUID().slice(0, 12)}`;
const base = ['compose', '--project-name', project, '--profile', 'test'];
function compose(args) {
  const result = spawnSync('docker', [...base, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error('Unable to run Docker. Check Docker installation and daemon access.');
  return result.status ?? 1;
}

let status = 1;
try {
  status = compose(['run', '--build', '--rm', 'test']);
} finally {
  const cleanup = compose(['down', '--volumes', '--remove-orphans']);
  if (cleanup !== 0) {
    console.error(`Integration cleanup failed for isolated project ${project}.`);
    if (status === 0) status = cleanup;
  }
}
process.exitCode = status;
