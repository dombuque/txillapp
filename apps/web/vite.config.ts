import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';


const build = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A versão nova descarrega sozinha em segundo plano; a pessoa escolhe quando atualizar (sem perder o que está a escrever).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Txillapp',
        short_name: 'Txillapp',
        description: 'Rede social, showoff e Txills',
        theme_color: '#d6334f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        id: '/',
        scope: '/',
        orientation: 'portrait',
        lang: 'pt',
        categories: ['social'],
        icons: [
          { src: 'icon-192.png?v=3', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Nunca fazer cache de respostas da API (podem ser privadas/financeiras).
      workbox: { navigateFallbackDenylist: [/^\/api\//], importScripts: ['push-sw.js'] },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
    // Só em desenvolvimento: permite abrir a app por um túnel HTTPS (para testar no telemóvel).
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.loca.lt'],
  },
  preview: {
    proxy: { '/api': 'http://localhost:3000' },
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.loca.lt'],
  },
});
