import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const resolvedApiKey = env.GEMINI_API_KEY || env.API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': resolvedApiKey ? JSON.stringify(resolvedApiKey) : '((typeof window !== "undefined" && window.process?.env?.API_KEY) || "")',
        'process.env.GEMINI_API_KEY': resolvedApiKey ? JSON.stringify(resolvedApiKey) : '((typeof window !== "undefined" && window.process?.env?.API_KEY) || "")'
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
