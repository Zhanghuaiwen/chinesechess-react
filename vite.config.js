import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pikafishPlugin } from './vite-plugin-pikafish.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pikafishPlugin()],
  // 监听所有网卡：局域网内其它设备可用「本机 IP:5174」访问
  server: { host: true },
  preview: { host: true },
})
