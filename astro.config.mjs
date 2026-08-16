// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE = 'https://poker-vlog.pages.dev';
// GitHub Pages 部署在子路径 /poker-vlog/ 下，需通过 BASE_PATH 环境变量覆盖 base，
// 否则 HTML 中资源路径（/images/xxx.png）指向根路径导致 404 图片不显示。
// 本地 / Cloudflare Pages（根路径部署）保持默认 '/'。
const BASE = process.env.BASE_PATH || '/';

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
