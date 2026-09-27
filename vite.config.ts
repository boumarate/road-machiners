import { defineConfig } from 'vite'

// Agents edit files while the game runs, so the page reloads only by hand.
export default defineConfig({
  server: { hmr: false },
})
