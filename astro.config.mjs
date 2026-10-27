// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages serves this repository under /kala-typing-master/.
// Override with SITE / BASE_PATH for a custom domain or a fork.
export default defineConfig({
  site: process.env.SITE ?? 'https://robispider.github.io',
  base: process.env.BASE_PATH ?? '/kala-typing-master',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
