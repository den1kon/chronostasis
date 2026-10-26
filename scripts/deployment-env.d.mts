export type DeploymentEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type DeploymentConfig = {
  environment: 'preview' | 'production';
  branch: string;
  databaseTarget: 'integration' | 'production';
  prepareDatabase: boolean;
  databaseUrl: string;
  migrationDatabaseUrl: string;
};

export function readDeploymentEnv(env: DeploymentEnvironment): DeploymentConfig;
