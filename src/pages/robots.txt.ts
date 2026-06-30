import type { APIRoute } from 'astro';

const BASE = import.meta.env.BASE_URL || '';

export const GET: APIRoute = ({ site }) => {
  const robotsTxt = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${site}${BASE}sitemap-index.xml`,
  ].join('\n');

  return new Response(robotsTxt, {
    headers: { 'Content-Type': 'text/plain' },
  });
};
