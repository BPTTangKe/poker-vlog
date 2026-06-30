// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE = 'https://BPTTangKe.github.io';
const BASE = '/poker-vlog';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  integrations: [
    sitemap({
      changefreq: 'daily',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
  prefetch: {
    prefetchAll: true,
  },
});
