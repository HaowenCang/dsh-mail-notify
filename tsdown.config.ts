import { defineConfig } from 'tsdown'

/**
 * The browser half's bundle.
 *
 * DSH serves an external client plugin as exactly one classic script, loaded
 * through `window.__ModuleLoader__.load({ id, factory })`, where the factory
 * receives a `require` that resolves the shell's seed module table. Two
 * consequences are hard requirements rather than preferences:
 *
 * - the output must be **CommonJS**, because the factory form cannot deliver
 *   ESM bindings and no top-level `import` or `export` may survive;
 * - React and React DOM must stay **unbundled**, so the bundle shares the
 *   shell's single React instance instead of shipping a second one. The
 *   envelope's `require` is what supplies them.
 *
 * The client has no other runtime dependency. Everything it says about DSH is a
 * type-only import erased before this config ever sees the module graph, which
 * is why the externals list is exactly four React entry points and why a second
 * React copy cannot appear by accident.
 *
 * `clean` is off because the host half is emitted into the same directory by
 * `tsc`; a bundler clean would delete it.
 */
const PLUGIN_ID = 'dsh-mail-notify'

/** The loader envelope's opening, matched byte for byte to the shipped format. */
const BANNER = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(PLUGIN_ID)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
].join('\n')

/** The loader envelope's closing half. */
const FOOTER = '\t\treturn module.exports;\n\t}\n});'

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    onlyBundle: false,
  },
  banner: BANNER,
  footer: FOOTER,
})
