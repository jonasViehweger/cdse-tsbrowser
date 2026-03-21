import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const cdseAuthProxy = {
  target: 'https://identity.dataspace.copernicus.eu',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/cdse-auth/, ''),
}

const cdseApiProxy = {
  target: 'https://sh.dataspace.copernicus.eu',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/cdse-api/, ''),
}

export default defineConfig({
  base: '/cdse-tsbrowser/',
  plugins: [vue()],
  server: {
    proxy: {
      '/cdse-auth': cdseAuthProxy,
      '/cdse-api': cdseApiProxy,
    },
  },
  preview: {
    proxy: {
      '/cdse-auth': cdseAuthProxy,
      '/cdse-api': cdseApiProxy,
    },
  },
})
