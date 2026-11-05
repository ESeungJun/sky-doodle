import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// 하늘(index)과 어드민(admin/) 두 페이지
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
})
