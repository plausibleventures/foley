// The checker is TypeScript, because everything it checks is. esbuild is already in the tree for
// vite, so bundling it in memory costs nothing and avoids a build step that could go stale.
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['tools/check.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'warning',
});

const source = result.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
