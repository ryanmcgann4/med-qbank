import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Home-screen icons fill edge-to-edge with the brand color (no white frame).
const brand = { padding: 0.25, resizeOptions: { background: '#4f46e5', fit: 'contain' as const } };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...brand },
    apple: { ...minimal2023Preset.apple, ...brand },
  },
  images: ['public/favicon.svg'],
});
