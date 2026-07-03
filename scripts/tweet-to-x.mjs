/**
 * 发推到 X (Twitter)
 *
 * 双模式：
 *   1. Playwright 自动发推（需要 GUI 环境 + Chrome 已登录）
 *   2. 降级：打开 X intent URL 预填充推文（只需手动点发送）
 *
 * 用法：
 *   node scripts/tweet-to-x.mjs [--vlog-slug <slug>] [--intent-only]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');
const SITE_URL = process.env.SITE_URL || 'https://poker-vlog.pages.dev';

// 系统 Chrome 可执行路径
const CHROME_EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

function intentFallback(tweetText) {
  const encoded = encodeURIComponent(tweetText);
  const url = `https://x.com/intent/tweet?text=${encoded}`;
  console.log('[FALLBACK] Opening X intent URL in Chrome...');
  execSync(`open -a "Google Chrome" "${url}"`, { stdio: 'ignore' });
  console.log('Tweet pre-filled. Please click "Post" button manually in Chrome.');
  return { mode: 'intent_fallback', url };
}

async function playwrightMode(tweetText) {
  const { chromium } = await import('playwright');
  const CHROME_PROFILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

  if (!fs.existsSync(CHROME_PROFILE)) {
    throw new Error(`Chrome profile not found: ${CHROME_PROFILE}`);
  }

  // 如果 Chrome 正在运行，先关闭
  let chromeWasRunning = false;
  try {
    execSync('pgrep -x "Google Chrome"', { encoding: 'utf-8' });
    chromeWasRunning = true;
    console.log('Closing Chrome temporarily to access profile...');
    execSync('killall "Google Chrome"', { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 2000));
  } catch { /* Chrome not running, fine */ }

  let context;
  try {
    console.log('Launching browser...');
    const timeout = 30000;
    const launchPromise = chromium.launchPersistentContext(CHROME_PROFILE, {
      headless: false,
      executablePath: CHROME_EXE,
      viewport: { width: 1280, height: 800 },
      timeout,
    });

    context = await Promise.race([
      launchPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('PLAYWRIGHT_TIMEOUT')), timeout + 5000)),
    ]);

    const page = context.pages()[0] || await context.newPage();
    console.log('Opening X.com...');

    await page.goto('https://x.com/home', { waitUntil: 'networkidle', timeout: 30000 });

    const tweetArea = page.locator('[data-testid="tweetTextarea_0"]');
    await tweetArea.waitFor({ state: 'visible', timeout: 15000 });

    console.log('Logged in. Composing tweet...');
    await tweetArea.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(tweetText, { delay: 10 });
    await page.waitForTimeout(500);

    const postButton = page.locator('[data-testid="tweetButtonInline"]');
    await postButton.click();
    await page.waitForTimeout(3000);

    console.log('Tweet posted successfully!');
    await page.screenshot({ path: path.join(__dirname, '..', 'tweet-result.png') });
    return { mode: 'playwright', success: true };
  } finally {
    if (context) await context.close().catch(() => {});
    if (chromeWasRunning) {
      execSync('open -a "Google Chrome"', { stdio: 'ignore' });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.includes('--vlog-slug')
    ? args[args.indexOf('--vlog-slug') + 1]
    : null;
  const intentOnly = args.includes('--intent-only');

  const vlog = getLatestVlog(slug);
  const tweetText = buildTweet(vlog);

  console.log(`Vlog: ${vlog.title}`);
  console.log(`Tweet (${tweetText.length} chars):`);
  console.log(tweetText);
  console.log('');

  // 强制 intent-only 模式
  if (intentOnly) {
    const result = intentFallback(tweetText);
    console.log(JSON.stringify(result));
    return;
  }

  // 先尝试 Playwright 自动发推，失败则降级
  try {
    const result = await playwrightMode(tweetText);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(`Playwright mode failed: ${err.message}`);
    const result = intentFallback(tweetText);
    console.log(JSON.stringify(result));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
