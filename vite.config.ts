import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Fetch from Render.com environment variable "API_KEY", falling back to GEMINI_API_KEY
    const resolvedApiKey = env.API_KEY || process.env.API_KEY || env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'html-transform',
          transformIndexHtml(html) {
            if (resolvedApiKey) {
              return html.replace(/RENDER_API_KEY_PLACEHOLDER/g, resolvedApiKey);
            }
            return html;
          }
        }
      ],
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
