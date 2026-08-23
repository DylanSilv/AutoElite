import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Empaquetado para producción.
 *
 * Se usa un bundler y no `tsc` a secas porque `@autoelite/shared` se consume
 * como código fuente del monorepo: TypeScript no reescribe el alias, así que el
 * JavaScript emitido no resolvería el import en tiempo de ejecución.
 *
 * Las dependencias de node_modules quedan externas —se instalan en la imagen—
 * y sólo se empaqueta el código propio. Prisma en particular tiene que quedar
 * afuera: arrastra binarios nativos que no se pueden bundlear.
 */

const packageJson = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8'),
);

const external = Object.keys(packageJson.dependencies).filter(
  (name) => name !== '@autoelite/shared',
);

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  alias: { '@autoelite/shared': shared },
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/http/server.ts'],
  outfile: 'dist/server.js',
});

// El seed se empaqueta aparte: es lo que carga los datos de demostración en un
// entorno recién levantado.
await build({
  ...common,
  entryPoints: ['prisma/seed.ts'],
  outfile: 'dist/seed.js',
});
