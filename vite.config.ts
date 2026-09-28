import { defineConfig } from 'vite'

// Agents edit files while the game runs, so the page reloads only by hand.
// A relative base lets the build run from any folder, like an itch.io upload.
export default defineConfig({
  base: './',
  server: { hmr: false },
})
