import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The test setup every service shares, which is all of it.
 *
 * One runner definition rather than a config per service: the six jest blocks
 * this replaces had drifted into six copies of the same eight lines.
 *
 * swc rather than vite's own esbuild, and this is the whole reason the plugin
 * is here: esbuild does not implement `emitDecoratorMetadata`, and Nest's
 * injector reads exactly that — the `design:paramtypes` a decorated
 * constructor emits is how `Test.createTestingModule` knows what to hand a
 * provider. Under esbuild every injected argument arrives undefined.
 *
 * `.mts`, because these files are ESM and every package here is still
 * CommonJS. Vite's native config loader goes by the extension and warns that
 * it is about to stop guessing.
 */
export const canopusVitest = (include: string[]) =>
  defineConfig({
    plugins: [
      swc.vite({
        module: { type: 'es6' },
        jsc: {
          target: 'es2021',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
      }),
    ],
    test: {
      // `describe`/`it`/`expect`/`vi` without importing them in every file,
      // which is what the suites were written against.
      globals: true,
      environment: 'node',
      include,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reportsDirectory: 'coverage',
      },
    },
  });

/** The unit suites: what `pnpm test` runs. */
export default canopusVitest(['src/**/*.spec.ts']);
