import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, '.', '')

  if (command === 'build' && !environment.VITE_API_BASE_URL?.trim()) {
    throw new Error('Missing required production environment variable: VITE_API_BASE_URL')
  }

  return {
    plugins: [react()],
  }
})
