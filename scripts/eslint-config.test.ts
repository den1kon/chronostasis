import {ESLint} from 'eslint';
import {describe, expect, it} from 'vitest';

describe('ESLint policy', () => {
  it('applies GTS formatting together with strict TypeScript and browser boundaries', async () => {
    const eslint = new ESLint({cwd: process.cwd()});
    const typeScript = JSON.stringify(
      await eslint.calculateConfigForFile('packages/api/src/env.ts'),
    );
    const browser = JSON.stringify(
      await eslint.calculateConfigForFile('apps/web/src/app.tsx'),
    );

    expect(typeScript).toContain('"prettier/prettier":[2');
    expect(typeScript).toContain('"@typescript-eslint/no-explicit-any":[2');
    expect(typeScript).toContain(
      '"@typescript-eslint/no-floating-promises":[2',
    );
    expect(browser).toContain('"react-hooks/rules-of-hooks":[2');
    expect(browser).toContain('"no-restricted-imports":[2');
  });
});
