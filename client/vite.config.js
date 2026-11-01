import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// In dev, /api calls are proxied to Express, so the browser sees ONE origin (cookies just work, no CORS needed).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network addresses (0.0.0.0) so mobile devices on the same Wi-Fi can connect
    port: 5173,
    proxy: { '/api': 'http://localhost:5000' },
  },
});
