import {describe, expect, it} from 'vitest';
import {shouldIgnoreDeployment} from './ignore-vercel-build.mjs';

describe('shouldIgnoreDeployment', () => {
  it('skips automatic Preview builds for integration', () => {
    expect(
      shouldIgnoreDeployment({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'integration',
      }),
    ).toBe(true);
  });

  it.each([
    {VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/one'},
    {VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main'},
    {VERCEL_ENV: 'preview'},
    {},
  ])('builds other deployments or missing metadata (%j)', env => {
    expect(shouldIgnoreDeployment(env)).toBe(false);
  });
});
