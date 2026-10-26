export type DeploymentEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type ChildOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
  stdio: 'inherit';
};

export type ChildResult = {
  status: number | null;
  error?: Error;
  signal?: NodeJS.Signals | string | null;
};

export type ChildRunner = (
  executable: string,
  args: string[],
  options: ChildOptions,
) => ChildResult;

export function runDeployment(options: {
  env: DeploymentEnvironment;
  run?: ChildRunner;
}): number;
