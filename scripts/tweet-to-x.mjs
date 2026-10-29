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
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');

/** 读取项目根目录 .env（供 X 官方 API 模式使用；已存在的环境变量优先） */
function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnvFile();

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
    // 以文件名末尾的 YYYY-MM-DD 为准（git checkout / 编辑器保存都会改 mtime，
    // 仅按 mtime 排序会选错文章）；无日期后缀时回退到 mtime。
    const dateOf = (f) => {
      const m = f.match(/(\d{4}-\d{2}-\d{2})\.md$/);
      if (m) return m[1];
      const raw = fs.readFileSync(path.join(VLOG_DIR, f), 'utf-8');
      const d = raw.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m);
      return d ? d[1] : '0000-00-00';
    };
    const sorted = files
      .map(f => ({ name: f, date: dateOf(f), mtime: fs.statSync(path.join(VLOG_DIR, f)).mtimeMs }))
      .sort((a, b) => (b.date.localeCompare(a.date)) || (b.mtime - a.mtime));
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
// 专供自动化发推的独立 Chrome 配置目录（与日常浏览器隔离，首次需登录一次 X）
const CDP_PROFILE = process.env.X_CHROME_PROFILE || path.join(os.homedir(), '.poker-vlog-x-chrome');
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

  // 日常使用的 Chrome 通常不带 --remote-debugging-port，且不能强杀用户浏览器。
  // 因此这里用「独立 user-data-dir」再起一个 Chrome 实例：与日常浏览器完全隔离，
  // 不影响用户已开的窗口，又能稳定提供 CDP。首次需在该窗口登录一次 X，cookie 会持久化。
  console.log(`Launching dedicated Chrome (profile: ${CDP_PROFILE}) with remote debugging...`);
  execSync(
    `nohup "${CHROME_EXE}" --remote-debugging-port=${CDP_PORT} --user-data-dir="${CDP_PROFILE}" --no-first-run --no-default-browser-check --restore-last-session=false --disable-session-crashed-bubble --disable-background-networking > /dev/null 2>&1 &`,
    { stdio: 'ignore' }
  );

  // 等待 CDP 就绪（最多 90s）
  let attempts = 0;
  while (!isCdpAvailable() && attempts < 90) {
    execSync('sleep 1');
    attempts++;
  }

  if (!isCdpAvailable()) {
    throw new Error(`Chrome CDP failed to start within ${attempts}s`);
  }

  console.log('Chrome launched with CDP.');
  return { wasRunning: false, launched: true };
}

// ── X 官方 API 模式（首选，无需 GUI / Chrome）────────────────────────────
const X_API_KEYS = [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
];

async function apiMode(tweetText) {
  const missing = X_API_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) throw new Error(`X API 凭证缺失: ${missing.join(', ')}`);

  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  const { data } = await client.v2.tweet(tweetText);
  return {
    mode: 'api',
    success: true,
    tweetId: data.id,
    url: `https://x.com/i/status/${data.id}`,
  };
}

// ── 发布前置检查：确认文章与封面已可访问（规避 push 后 Pages 部署延迟导致 404）──
async function probeOk(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: e.name || 'ERR' };
  }
}

async function waitReachable(urls, maxWaitMs = 240000, intervalMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  let pending = urls;
  let last = {};
  while (pending.length > 0) {
    const results = await Promise.all(pending.map(async (u) => ({ u, r: await probeOk(u) })));
    last = Object.fromEntries(results.map(({ u, r }) => [u, r.status]));
    pending = results.filter(({ r }) => !r.ok).map(({ u }) => u);
    if (pending.length === 0) return { ready: true, statuses: last };
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ready: pending.length === 0, statuses: last };
}

/**
 * README 封面预热：README 用 jsDelivr / GitHub Pages 绝对地址，新图在 jsDelivr
 * 属惰性拉取；首次被 GitHub camo 抓取时若尚未回源会 404 并被缓存，
 * 表现为「GitHub 上图片不显示」。发推前主动 GET 一次，把负缓存窗口提前消掉。
 */
async function warmReadmeCover(slug) {
  const urls = [
    `https://cdn.jsdelivr.net/gh/BPTTangKe/poker-vlog@main/images/${slug}.png`,
    `https://bpttangke.github.io/poker-vlog/images/${slug}.png`,
  ];
  for (const u of urls) {
    for (let i = 1; i <= 3; i++) {
      const r = await probeOk(u, 10000);
      if (r.ok) {
        console.log(`[WARM] ${r.status} ${u}`);
        break;
      }
      if (i === 3) console.warn(`[WARM] 未就绪(${r.status}) ${u}`);
      else await new Promise((res) => setTimeout(res, 4000));
    }
  }
}

async function preflight(vlog) {
  const origin = SITE_URL.replace(/\/$/, '');
  const articleUrl = `${origin}/vlog/${vlog.slug}`;
  const coverUrl = `${origin}/images/${vlog.slug}.png`;
  console.log(`[PREFLIGHT] 等待文章与封面可访问（最长 240s，覆盖 GitHub Pages 部署延迟）...`);
  const r = await waitReachable([articleUrl, coverUrl]);
  await warmReadmeCover(vlog.slug);
  for (const [u, s] of Object.entries(r.statuses)) {
    console.log(`[PREFLIGHT] ${s} ${u}`);
  }
  if (!r.ready) {
    console.warn('[PREFLIGHT] 仍有资源未就绪，推文照常发送（稍后可自动恢复）');
  }
  return r;
}

async function playwrightMode(tweetText) {
  const { chromium } = await import('playwright');

  const chromeState = ensureChromeWithCDP();

  let browser;
  try {
    console.log('Connecting to Chrome via CDP...');
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });

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

/**
 * 登录引导模式（--login）：Playwright 发推失败最常见原因是专用 Chrome profile
 * 里没有 X 登录态（auth_token）。此处打开登录页并由用户手动完成一次登录
 * （不代替用户输入密码、不绕过任何验证码），检测到 auth_token 后即退出。
 */
async function loginMode() {
  const { chromium } = await import('playwright');
  ensureChromeWithCDP();
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });
  try {
    const context = browser.contexts()[0];
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[LOGIN] 请在打开的 Chrome 窗口中完成 X 登录（最长等待 10 分钟）...');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const cookies = await context.cookies('https://x.com').catch(() => []);
      if (cookies.some((c) => c.name === 'auth_token' && c.value)) {
        console.log('[LOGIN] 已检测到 auth_token，登录态已持久化到专用 profile，后续发推可全自动。');
        return { mode: 'login', success: true };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('登录等待超时（10 分钟未检测到 auth_token）');
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.includes('--vlog-slug')
    ? args[args.indexOf('--vlog-slug') + 1]
    : null;
  const intentOnly = args.includes('--intent-only');

  if (args.includes('--login')) {
    const r = await loginMode();
    console.log(JSON.stringify(r));
    return;
  }

  const vlog = getLatestVlog(slug);
  const tweetText = buildTweet(vlog);
  const dryRun = args.includes('--dry-run');

  console.log(`Vlog: ${vlog.title}`);
  console.log(`Tweet (${tweetText.length} chars):`);
  console.log(tweetText);
  console.log('');

  await preflight(vlog);

  if (dryRun) {
    console.log('[DRY-RUN] 跳过实际发推');
    console.log(JSON.stringify({ mode: 'dry-run', success: true, textLen: tweetText.length }));
    return;
  }

  // 强制 intent-only 模式
  if (intentOnly) {
    const result = intentFallback(tweetText);
    console.log(JSON.stringify(result));
    return;
  }

  // 1) 首选官方 API（无需 GUI，可全自动）
  try {
    const result = await apiMode(tweetText);
    console.log('[OK] X API 发布成功');
    console.log(JSON.stringify(result));
    return;
  } catch (err) {
    console.error(`X API 模式失败: ${err.message}`);
  }

  // 2) 降级 Playwright（需要带 CDP 的 Chrome）
  try {
    const result = await playwrightMode(tweetText);
    console.log(JSON.stringify(result));
    return;
  } catch (err) {
    console.error(`Playwright mode failed: ${err.message}`);
  }

  // 3) 最后降级：intent 预填，人工点发送
  const result = intentFallback(tweetText);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
