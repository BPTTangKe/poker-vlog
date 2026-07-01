/**
 * 通过 Playwright 浏览器自动化发推到 X (Twitter)
 *
 * 用法：
 *   node scripts/tweet-to-x.mjs [--vlog-slug <slug>]
 *
 * 需要：
 *   系统 Chrome 已登录 X 账号 @BPT_TK
 *   首次运行会复用 Chrome 的登录状态
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');
const SITE_URL = process.env.SITE_URL || 'https://poker-vlog.pages.dev';

// Chrome 用户数据目录（复用登录状态）
const CHROME_PROFILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

function getLatestVlog(slug) {
  const files = fs.readdirSync(VLOG_DIR).filter(f => f.endsWith('.md'));
  if (files.length === 0) throw new Error('No vlog files found');

  let targetFile;
  if (slug) {
    targetFile = files.find(f => f === `${slug}.md`);
    if (!targetFile) throw new Error(`Slug "${slug}" not found`);
  } else {
    const sorted = files
      .map(f => ({ name: f, mtime: fs.statSync(path.join(VLOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    targetFile = sorted[0].name;
  }

  const raw = fs.readFileSync(path.join(VLOG_DIR, targetFile), 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error(`Cannot parse frontmatter of ${targetFile}`);

  const fm = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (m) {
      const val = m[2].trim();
      fm[m[1]] = val.startsWith('"') ? val.slice(1, -1) : val;
    }
  }

  return {
    slug: targetFile.replace('.md', ''),
    title: fm.title || '',
    excerpt: fm.excerpt || '',
  };
}

function buildTweet(vlog) {
  const link = `${SITE_URL}/vlog/${vlog.slug}`;
  const excerpt = vlog.excerpt.length > 180
    ? vlog.excerpt.slice(0, 177) + '...'
    : vlog.excerpt;
  return `${vlog.title}\n\n${excerpt}\n\n${link}`;
}

async function main() {
  const slug = process.argv.includes('--vlog-slug')
    ? process.argv[process.argv.indexOf('--vlog-slug') + 1]
    : null;

  const vlog = getLatestVlog(slug);
  const tweetText = buildTweet(vlog);

  console.log(`Vlog: ${vlog.title}`);
  console.log(`Tweet (${tweetText.length} chars):`);
  console.log(tweetText);
  console.log('');

  // 检查 Chrome profile 是否存在
  const userDataDir = path.join(CHROME_PROFILE, 'Default');
  if (!fs.existsSync(userDataDir)) {
    throw new Error(`Chrome profile not found: ${userDataDir}`);
  }

  console.log('Launching browser...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('Opening X.com...');

  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 等待发推输入区出现（X 是 SPA，需要等待动态渲染 + 登录状态恢复）
    const tweetArea = page.locator('[data-testid="tweetTextarea_0"]');
    try {
      await tweetArea.waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      console.error('Timed out waiting for tweet input area. Possibly not logged in or X changed UI.');
      await page.screenshot({ path: path.join(__dirname, '..', 'tweet-error.png') });
      await context.close();
      process.exit(1);
    }

    console.log('Logged in. Composing tweet...');

    // 点击发推输入区
    await tweetArea.click();
    await page.waitForTimeout(500);

    // 输入推文内容
    await page.keyboard.type(tweetText, { delay: 10 });
    await page.waitForTimeout(500);

    // 点击发推按钮
    const postButton = page.locator('[data-testid="tweetButtonInline"]');
    await postButton.click();

    // 等待发布完成
    await page.waitForTimeout(3000);

    console.log('Tweet posted successfully!');

    // 截图确认
    await page.screenshot({ path: path.join(__dirname, '..', 'tweet-result.png') });
    console.log('Screenshot saved to tweet-result.png');
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'tweet-error.png') });
    console.log('Error screenshot saved to tweet-error.png');
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
