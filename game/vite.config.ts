import { defineConfig } from 'vite'
import { gameVersion } from './src/version'

// Agents edit files while the game runs, so the page reloads only by hand.
// A relative base lets the build run from any folder, like an itch.io upload.
export default defineConfig({
  base: './',
  server: { hmr: false },
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())),
    __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? ''),
  },
})
