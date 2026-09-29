import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

// Agents edit files while the game runs, so the page reloads only by hand.
// A relative base lets the build run from any folder, like an itch.io upload.
export default defineConfig({
  base: './',
  server: { hmr: false },
  define: { __GAME_VERSION__: JSON.stringify(version) },
})
