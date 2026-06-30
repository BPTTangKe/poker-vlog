import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context: { site: URL | string }) {
  const vlogs = await getCollection('vlog');
  vlogs.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: '德州扑克每日 Vlog',
    description: '每日德州扑克 vlog，专业手牌分析、锦标赛复盘、GTO 策略入门和资金管理指南。',
    site: context.site instanceof URL ? context.site : new URL(String(context.site)),
    items: vlogs.map(vlog => ({
      title: vlog.data.title,
      description: vlog.data.seo_description || vlog.data.excerpt,
      pubDate: vlog.data.date,
      link: `/vlog/${vlog.id.replace(/\.md$/, '')}`,
      categories: vlog.data.tags,
    })),
    customData: `<language>zh-CN</language>`,
    stylesheet: '/rss/styles.xsl',
  });
}
