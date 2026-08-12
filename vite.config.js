import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pikafishPlugin } from './vite-plugin-pikafish.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pikafishPlugin()],
})
