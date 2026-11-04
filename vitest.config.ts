import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: the Cloudflare plugin there can't run under Vitest.
export default defineConfig({})
