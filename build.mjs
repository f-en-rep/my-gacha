// Builds:
//   dist/bridge.js   CardBridge runtime that is embedded into converted SillyTavern cards
//   dist/index.html  the converter page (single file, works offline)
//   docs/index.html  the same page for GitHub Pages
import * as esbuild from 'esbuild'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const VERSION = pkg.version

// wasmoon ships a node code path; the browser never takes it
const emptyNodeBuiltins = {
  name: 'empty-node-builtins',
  setup(build) {
    build.onResolve({ filter: /^(fs|path|url|module|child_process|os|crypto|util)$/ }, args => ({ path: args.path, namespace: 'empty' }))
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {}', loader: 'js' }))
  },
}

fs.mkdirSync('dist', { recursive: true })

await esbuild.build({
  entryPoints: ['src/bridge/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  loader: { '.lua': 'text', '.wasm': 'base64' },
  plugins: [emptyNodeBuiltins],
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: 'dist/bridge.js',
  logLevel: 'warning',
})

const ui = await esbuild.build({
  entryPoints: ['src/ui/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  loader: { '.lua': 'text', '.wasm': 'base64', '.bridge': 'text' },
  plugins: [
    emptyNodeBuiltins,
    {
      name: 'bridge-code',
      setup(build) {
        build.onResolve({ filter: /^bridge-code$/ }, () => ({ path: 'bridge-code', namespace: 'bridge' }))
        build.onLoad({ filter: /.*/, namespace: 'bridge' }, () => ({
          contents: `export const BRIDGE_CODE = ${JSON.stringify(fs.readFileSync('dist/bridge.js', 'utf8'))}; export const BRIDGE_VERSION = ${JSON.stringify(VERSION)};`,
          loader: 'js',
        }))
      },
    },
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  logLevel: 'warning',
})

const js = ui.outputFiles[0].text.replaceAll('</script', '<\\/script')
const html = fs.readFileSync('src/ui/index.html', 'utf8').replace('/*APP*/', () => js).replaceAll('{{VERSION}}', VERSION)
fs.writeFileSync('dist/index.html', html)

// GitHub Pages serves the docs/ folder
fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/index.html', html)
fs.writeFileSync('docs/.nojekyll', '')

const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + 'KB'
console.log('bridge.js', kb('dist/bridge.js'), '| index.html', kb('dist/index.html'))
