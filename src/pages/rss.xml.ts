import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context: { site: URL | string }) {
  const vlogs = await getCollection('vlog');
  vlogs.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: 'Poker Vlog | Free Poker Tracker & Strategy',
    description: 'Master Texas Hold\'em with our free poker tracker. Daily strategy vlogs, session tracking, bankroll management, and poker logger.',
    site: context.site instanceof URL ? context.site : new URL(String(context.site)),
    items: vlogs.map(vlog => ({
      title: vlog.data.title,
      description: vlog.data.seo_description || vlog.data.excerpt,
      pubDate: vlog.data.date,
      link: `/vlog/${vlog.id.replace(/\.md$/, '')}`,
      categories: vlog.data.tags,
    })),
    customData: `<language>en</language>`,
    stylesheet: '/rss/styles.xsl',
  });
}
