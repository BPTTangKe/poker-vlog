/**
 * 将最新 vlog 发布到社交平台
 *
 * 用法：
 *   node scripts/publish-social.mjs [--dry-run]
 *
 * 环境变量：
 *   TWITTER_API_KEY           - X (Twitter) API Key
 *   TWITTER_API_SECRET        - X (Twitter) API Secret
 *   TWITTER_ACCESS_TOKEN      - X (Twitter) Access Token
 *   TWITTER_ACCESS_SECRET     - X (Twitter) Access Token Secret
 *   REDDIT_CLIENT_ID          - Reddit API Client ID
 *   REDDIT_CLIENT_SECRET      - Reddit API Client Secret
 *   REDDIT_USERNAME           - Reddit 用户名
 *   REDDIT_PASSWORD           - Reddit 密码
 *   REDDIT_USER_AGENT         - Reddit User Agent 字符串
 *   SITE_URL                  - 网站 URL（用于生成链接）
 *   VLOG_SLUG                 - 要发布的 vlog slug（可选，默认最新）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');

const SITE_URL = process.env.SITE_URL || 'https://example.github.io/poker-vlog';
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`[${ts}] ${prefix} ${msg}`);
}

/**
 * 获取最新的 vlog 文件
 */
function getLatestVlog(slug) {
  const files = fs.readdirSync(VLOG_DIR).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    throw new Error('没有找到 vlog 文件');
  }

  let targetFile;
  if (slug) {
    targetFile = files.find(f => f === `${slug}.md`);
    if (!targetFile) {
      throw new Error(`找不到 slug 为 "${slug}" 的 vlog 文件`);
    }
  } else {
    // 按文件修改时间排序，取最新的
    const sorted = files
      .map(f => ({ name: f, mtime: fs.statSync(path.join(VLOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    targetFile = sorted[0].name;
  }

  const filePath = path.join(VLOG_DIR, targetFile);
  const raw = fs.readFileSync(filePath, 'utf-8');

  // 解析 frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    throw new Error(`无法解析 ${targetFile} 的 frontmatter`);
  }

  const fm = {};
  const lines = fmMatch[1].split('\n');
  let currentKey = null;
  for (const line of lines) {
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val.startsWith('[')) {
        fm[currentKey] = JSON.parse(val);
      } else {
        fm[currentKey] = val.replace(/^"(.*)"$/, '$1');
      }
    }
  }

  const slugName = targetFile.replace('.md', '');
  return {
    slug: slugName,
    title: fm.title || '',
    excerpt: fm.excerpt || '',
    tags: fm.tags || [],
    date: fm.date || '',
    filePath,
  };
}

// ─────────────────────────────────────────────────
// 平台发布函数
// ─────────────────────────────────────────────────

/**
 * 发布到 X (Twitter) API v2
 * 需要 twitter-api-v2 包
 */
async function publishToTwitter(vlog) {
  log('准备发布到 X (Twitter)...');

  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    log('X (Twitter) API 凭证未完整配置，跳过', 'WARN');
    return { platform: 'twitter', status: 'skipped', reason: '凭证未配置' };
  }

  if (DRY_RUN) {
    log(`[DRY RUN] 将发布到 X: "${vlog.title}" - ${SITE_URL}/vlog/${vlog.slug}`, 'WARN');
    return { platform: 'twitter', status: 'dry_run' };
  }

  try {
    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessSecret,
    });

    const tweet = `${vlog.title}\n\n${vlog.excerpt.slice(0, 180)}\n\n${SITE_URL}/vlog/${vlog.slug}`;
    const { data } = await client.v2.tweet(tweet);

    log(`X (Twitter) 发布成功: https://x.com/i/status/${data.id}`);
    return { platform: 'twitter', status: 'success', tweetId: data.id };
  } catch (err) {
    log(`X (Twitter) 发布失败: ${err.message}`, 'ERROR');
    return { platform: 'twitter', status: 'failed', error: err.message };
  }
}

/**
 * 发布到 Reddit (通过 snoowrap)
 * 需要 snoowrap 包
 */
async function publishToReddit(vlog) {
  log('准备发布到 Reddit...');

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent = process.env.REDDIT_USER_AGENT || 'PokerVlogBot/1.0';

  if (!clientId || !clientSecret || !username || !password) {
    log('Reddit API 凭证未完整配置，跳过', 'WARN');
    return { platform: 'reddit', status: 'skipped', reason: '凭证未配置' };
  }

  if (DRY_RUN) {
    log(`[DRY RUN] 将发布到 Reddit r/poker: "${vlog.title}"`, 'WARN');
    return { platform: 'reddit', status: 'dry_run' };
  }

  try {
    const snoowrap = (await import('snoowrap')).default;
    const r = new snoowrap({
      userAgent,
      clientId,
      clientSecret,
      username,
      password,
    });

    const subreddit = await r.getSubreddit('poker');

    // Reddit 发布格式：完整摘要 + 链接
    const text = `**${vlog.title}**\n\n${vlog.excerpt}\n\n[阅读全文](${SITE_URL}/vlog/${vlog.slug})`;
    const post = await subreddit.submitSelfpost({
      title: vlog.title,
      text,
    });

    log(`Reddit 发布成功: https://reddit.com${post.permalink}`);
    return { platform: 'reddit', status: 'success', permalink: post.permalink };
  } catch (err) {
    log(`Reddit 发布失败: ${err.message}`, 'ERROR');
    return { platform: 'reddit', status: 'failed', error: err.message };
  }
}

/**
 * 预留：发布到 Instagram
 *
 * 需要的参数：
 *   INSTAGRAM_ACCESS_TOKEN  - Instagram Graph API Access Token
 *   INSTAGRAM_USER_ID       - Instagram 用户 ID (Facebook Page ID)
 *   或使用 Instagram Basic Display API
 *
 * API 说明：
 *   需要先将 Instagram 账户关联到 Facebook Page，
 *   然后通过 Instagram Graph API 的 /media 端点发布内容。
 *   仅支持发布单张图片或视频（不支持纯文字）。
 *   因此需要先生成包含文字内容的图片。
 */
async function publishToInstagram(vlog) {
  log('Instagram 接口已预留，尚未实现', 'WARN');
  // TODO: 实现 Instagram 发布
  // 1. 将 vlog 标题和摘要渲染为图片
  // 2. 调用 Instagram Graph API：POST /{ig-user-id}/media
  // 3. 等待媒体处理完成后：POST /{ig-user-id}/media_publish
  return { platform: 'instagram', status: 'not_implemented' };
}

/**
 * 预留：发布到 Threads
 *
 * 需要的参数：
 *   THREADS_ACCESS_TOKEN    - Threads API Access Token
 *   THREADS_USER_ID         - Threads 用户 ID
 *
 * API 说明：
 *   Threads API 是 Meta 提供的，需要先创建 Meta App。
 *   通过 /{threads-user-id}/threads 端点发布文本内容。
 *   支持纯文本和链接，类似 Twitter 的发布模式。
 */
async function publishToThreads(vlog) {
  log('Threads 接口已预留，尚未实现', 'WARN');
  // TODO: 实现 Threads 发布
  // 1. 使用 Threads API：POST /{threads-user-id}/threads
  // 2. 参数：text, link_attachment (可选)
  return { platform: 'threads', status: 'not_implemented' };
}

/**
 * 预留：发布到 TikTok
 *
 * 需要的参数：
 *   TIKTOK_ACCESS_TOKEN     - TikTok API Access Token
 *   TIKTOK_OPEN_ID          - 授权用户的 Open ID
 *
 * API 说明：
 *   TikTok Content Posting API 需要视频文件。
 *   需要先用 FFmpeg 等工具将 vlog 内容生成短视频，
 *   然后通过 /post/publish/video/init/ 和 /video/publish/ 端点上传。
 */
async function publishToTikTok(vlog) {
  log('TikTok 接口已预留，尚未实现', 'WARN');
  // TODO: 实现 TikTok 发布
  // 1. 生成 vlog 内容摘要的视频（使用 FFmpeg 或其他工具）
  // 2. 初始化上传：POST /post/publish/video/init/
  // 3. 分块上传视频文件
  // 4. 发布：POST /post/publish/status/fetch/
  return { platform: 'tiktok', status: 'not_implemented' };
}

/**
 * 预留：发布到 YouTube
 *
 * 需要的参数：
 *   YOUTUBE_API_KEY         - YouTube Data API v3 Key
 *   YOUTUBE_CLIENT_ID       - OAuth 2.0 Client ID
 *   YOUTUBE_CLIENT_SECRET   - OAuth 2.0 Client Secret
 *   YOUTUBE_REFRESH_TOKEN   - OAuth 2.0 Refresh Token
 *
 * API 说明：
 *   需要通过 OAuth 2.0 认证获取 access token。
 *   使用 YouTube Data API v3 的 videos.insert 端点上传视频。
 *   需要先生成 vlog 内容的短视频。
 */
async function publishToYouTube(vlog) {
  log('YouTube 接口已预留，尚未实现', 'WARN');
  // TODO: 实现 YouTube 发布
  // 1. 生成 vlog 内容摘要的视频
  // 2. OAuth 2.0 认证
  // 3. 使用 YouTube Data API v3：videos.insert
  // 4. 设置标题、描述、标签和缩略图
  return { platform: 'youtube', status: 'not_implemented' };
}

/**
 * 发布到 Facebook Page
 *
 * 需要的参数：
 *   FACEBOOK_PAGE_ID          - Facebook 页面 ID
 *   FACEBOOK_PAGE_ACCESS_TOKEN - Facebook 页面 Access Token
 *
 * API 说明：
 *   使用 Facebook Graph API v20.0 的 /{page-id}/feed 端点。
 *   发布纯文本 + 链接帖子。
 *
 * 获取 Page Access Token 的方法：
 *   1. 访问 https://developers.facebook.com/tools/explorer/
 *   2. 获取 User Token（需要 pages_manage_posts 和 pages_read_engagement 权限）
 *   3. 调用 GET /me/accounts 获取页面列表和对应的 access_token
 *
 * 或使用 Facebook Business Suite 的调度发布功能。
 */
async function publishToFacebook(vlog) {
  log('准备发布到 Facebook...');

  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !pageAccessToken) {
    log('Facebook API 凭证未完整配置，跳过', 'WARN');
    return { platform: 'facebook', status: 'skipped', reason: '凭证未配置' };
  }

  if (DRY_RUN) {
    log(`[DRY RUN] 将发布到 Facebook Page (${pageId}): "${vlog.title}" - ${SITE_URL}/vlog/${vlog.slug}`, 'WARN');
    return { platform: 'facebook', status: 'dry_run' };
  }

  try {
    const message = `${vlog.title}\n\n${vlog.excerpt}\n\n${SITE_URL}/vlog/${vlog.slug}`;
    const url = `https://graph.facebook.com/v20.0/${pageId}/feed`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        link: `${SITE_URL}/vlog/${vlog.slug}`,
        access_token: pageAccessToken,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    log(`Facebook 发布成功: https://facebook.com/${data.id}`);
    return { platform: 'facebook', status: 'success', postId: data.id };
  } catch (err) {
    log(`Facebook 发布失败: ${err.message}`, 'ERROR');
    return { platform: 'facebook', status: 'failed', error: err.message };
  }
}

// ─────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────

async function main() {
  log('=== 社交媒体发布开始 ===');

  const slug = process.env.VLOG_SLUG || null;
  const vlog = getLatestVlog(slug);
  log(`目标 vlog: "${vlog.title}" (${vlog.date})`);

  const results = [];

  // 发布到各平台（按顺序执行以避免速率限制）
  results.push(await publishToTwitter(vlog));
  results.push(await publishToReddit(vlog));

  // 预留平台（仅在非 dry-run 模式下执行以显示状态）
  results.push(await publishToInstagram(vlog));
  results.push(await publishToThreads(vlog));
  results.push(await publishToTikTok(vlog));
  results.push(await publishToYouTube(vlog));
  results.push(await publishToFacebook(vlog));

  // 输出汇总
  log('=== 发布汇总 ===');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' :
                 r.status === 'dry_run' ? '🔍' :
                 r.status === 'skipped' ? '⏭️' :
                 r.status === 'not_implemented' ? '🚧' : '❌';
    const extra = r.tweetId ? ` (ID: ${r.tweetId})` :
                  r.permalink ? ` (${r.permalink})` :
                  r.reason ? ` - ${r.reason}` :
                  r.error ? ` - ${r.error}` : '';
    console.log(`  ${icon} ${r.platform}: ${r.status}${extra}`);
  }
}

main().catch(err => {
  console.error('发布脚本错误:', err);
  process.exit(1);
});
