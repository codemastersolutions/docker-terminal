const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: true,
  logLevel: 'info'
};

if (isWatch) {
  esbuild.context(config).then(ctx => ctx.watch()).catch(() => process.exit(1));
} else {
  esbuild.build(config).catch(() => process.exit(1));
}