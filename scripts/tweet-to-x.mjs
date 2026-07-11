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

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

/**
 * 检查 Chrome 是否已在 CDP 端口监听
 */
function isCdpAvailable() {
  try {
    const result = execSync(`curl -s -o /dev/null -w "%{http_code}" ${CDP_URL}/json/version`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return result.trim() === '200';
  } catch {
    return false;
  }
}

/**
 * 启动 Chrome 并开启远程调试端口
 * 返回 { wasRunning, launched } 以便 finally 做正确的清理
 */
function ensureChromeWithCDP() {
  // 先检查是否有 Chrome 进程已在 CDP 端口监听
  if (isCdpAvailable()) {
    console.log('Chrome CDP already available.');
    return { wasRunning: true, launched: false };
  }

  // 检查 Chrome 是否正在运行（但没有 CDP）
  let chromeRunning = false;
  try {
    execSync('pgrep -x "Google Chrome"', { encoding: 'utf-8' });
    chromeRunning = true;
    console.log('Closing existing Chrome to restart with CDP...');
    execSync('killall "Google Chrome"', { stdio: 'ignore' });
    // 等待进程完全退出
    let retries = 10;
    while (retries > 0) {
      try {
        execSync('pgrep -x "Google Chrome"', { encoding: 'utf-8' });
        retries--;
        execSync('sleep 1');
      } catch {
        break;
      }
    }
  } catch { /* Chrome not running */ }

  console.log('Launching Chrome with remote debugging...');
  // 使用直接可执行文件路径而非 open -a，确保 CDP 端口可靠绑定
  // 添加 --disable-extensions 加速启动，避免扩展拖慢 CDP 端口绑定
  execSync(
    `"${CHROME_EXE}" --remote-debugging-port=${CDP_PORT} --no-first-run --restore-last-session=false --disable-session-crashed-bubble --disable-extensions --disable-background-networking --disable-sync &>/dev/null &`,
    { stdio: 'ignore' }
  );

  // 等待 CDP 就绪（最多 60s，大 Profile 启动较慢）
  let attempts = 0;
  while (!isCdpAvailable() && attempts < 60) {
    execSync('sleep 1');
    attempts++;
  }

  if (!isCdpAvailable()) {
    throw new Error('Chrome CDP failed to start within 60s');
  }

  console.log('Chrome launched with CDP.');
  return { wasRunning: chromeRunning, launched: true };
}

async function playwrightMode(tweetText) {
  const { chromium } = await import('playwright');

  const chromeState = ensureChromeWithCDP();

  let browser;
  try {
    console.log('Connecting to Chrome via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL);

    // 获取已有页面或创建新页面
    const context = browser.contexts()[0];
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log('Opening X.com...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // X.com 是 SPA，等待 JS 渲染完成
    await page.waitForTimeout(5000);

    // 尝试多个可能的推文输入框选择器（X 经常变更）
    const tweetSelectors = [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea"]',
      '[role="textbox"][data-testid*="tweet"]',
      '[aria-label="Post text"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"]',
    ];

    let tweetArea = null;
    for (const sel of tweetSelectors) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 3000 });
        tweetArea = el;
        console.log(`Found tweet area with selector: ${sel}`);
        break;
      } catch {}
    }

    if (!tweetArea) {
      await page.screenshot({ path: path.join(__dirname, '..', 'x-debug.png'), fullPage: true });
      throw new Error('Tweet input area not found (screenshot saved as x-debug.png). X may require login or selector changed.');
    }

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
    if (browser) await browser.close().catch(() => {});
    // 如果是我们启动的 Chrome 且原本没有 Chrome，则保持运行；原本就有的保持原状
    // Chrome 以 open -a 启动后会留在 Dock，用户可正常使用
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
