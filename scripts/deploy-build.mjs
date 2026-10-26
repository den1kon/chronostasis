import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readDeploymentEnv} from './deployment-env.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function runChild(executable, args, options) {
  const result = spawnSync(executable, args, options);
  return {
    status: result.status,
    error: result.error,
    signal: result.signal,
  };
}

// Validate the target, typecheck, and build before preparing the database for
// Production or the integration branch; stop at the first failing stage.
export function runDeployment({env, run = runChild}) {
  let deployment;
  try {
    deployment = readDeploymentEnv(env);
  } catch (error) {
    console.error(
      `Deployment configuration failed: ${error instanceof Error ? error.message : 'invalid configuration'}`,
    );
    return 1;
  }

  const stages = [
    {
      name: 'web function typecheck',
      args: ['pnpm', '--filter', '@chronostasis/web', 'typecheck'],
    },
    {name: 'application build', args: ['pnpm', 'build']},
  ];
  if (deployment.prepareDatabase) {
    stages.push({name: 'database preparation', args: ['pnpm', 'db:prepare']});
  }

  for (const stage of stages) {
    console.log(
      `Deployment stage: ${stage.name} (${deployment.databaseTarget})`,
    );
    const childEnv = {...env};
    if (stage.name === 'database preparation') {
      // Pin preparation to the validated URLs instead of relying on fallback
      // precedence in the database command's environment reader.
      childEnv['DATABASE_URL'] = deployment.databaseUrl;
      childEnv['MIGRATION_DATABASE_URL'] = deployment.migrationDatabaseUrl;
    }
    const result = run('corepack', stage.args, {
      cwd: repositoryRoot,
      env: childEnv,
      stdio: 'inherit',
    });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`Deployment stage failed: ${stage.name}`);
      return typeof result.status === 'number' && result.status !== 0
        ? result.status
        : 1;
    }
  }
  return 0;
}

// Importing the runner for tests must not launch deployment processes.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = runDeployment({env: process.env});
}
