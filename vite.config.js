import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Two builds from one codebase:
//   default  -> GitHub Pages site, files live in GitHub
//   artifact -> one self-contained page, files live in the browser, seeded from ../todo/todo.md
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact'
  return {
    base: './',
    publicDir: artifact ? false : 'public',
    resolve: {
      alias: { 'virtual:local': fileURLToPath(new URL(artifact ? './src/local.js' : './src/local-stub.js', import.meta.url)) },
    },
    build: {
      target: 'es2022',
      outDir: artifact ? 'dist-artifact' : 'dist',
      cssCodeSplit: false,
      modulePreload: false,
    },
  }
})
