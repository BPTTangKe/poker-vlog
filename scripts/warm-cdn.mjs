#!/usr/bin/env node
/**
 * 封面图 CDN 预热脚本
 *
 * 背景：jsDelivr 对 GitHub @main 分支下的文件采用惰性拉取策略——
 * 每日 vlog 封面（文件名带日期、每天唯一）push 到 GitHub 后，jsDelivr
 * 需要等到第一次收到该 URL 的请求才会从 GitHub 拉取并建立 CDN 缓存。
 * 若此时 GitHub 用户正打开仓库 README / .md，jsDelivr 首次请求会 404，
 * 且 GitHub camo 代理会缓存片刻坏响应，导致"GitHub 上图片不显示"。
 *
 * 本脚本在 push 成功后运行：对 README Latest Vlogs 区段的全部封面图，
 * 以及仓库中所有 vlog 正文的 jsDelivr 封面图逐张发起 GET 请求，
 * 强制 jsDelivr 完成首次拉取与缓存建连，把 404 窗口提前消掉。
 *
 * 用法：
 *   node scripts/warm-cdn.mjs
 *
 * 退出码：0 = 全部预热成功；1 = 存在预热失败（会在日志中列出）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const README_PATH = path.join(PROJECT_DIR, 'README.md');
const VLOG_DIR = path.join(PROJECT_DIR, 'src', 'content', 'vlog');

// 收集 jsDelivr 封面 URL（.png 图片，.svg 无需预热——GitHub 不内嵌渲染 SVG）
function collectCdnUrls() {
  const urls = new Set();

  // 1. 从 README Latest Vlogs 区段提取
  if (fs.existsSync(README_PATH)) {
    const readme = fs.readFileSync(README_PATH, 'utf8');
    for (const m of readme.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^)\s]*\.png/g)) {
      urls.add(m[0]);
    }
  }

  // 2. 从所有 vlog md 正文提取
  if (fs.existsSync(VLOG_DIR)) {
    for (const f of fs.readdirSync(VLOG_DIR)) {
      if (!f.endsWith('.md')) continue;
      const md = fs.readFileSync(path.join(VLOG_DIR, f), 'utf8');
      for (const m of md.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^)\s]*\.png/g)) {
        urls.add(m[0]);
      }
    }
  }

  return [...urls];
}

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function warm(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (res.ok) return { url, ok: true, status: res.status, attempt };
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return { url, ok: false, status: 'ERR' };
}

async function main() {
  const urls = collectCdnUrls();
  if (urls.length === 0) {
    log('未找到任何 jsDelivr 封面图 URL，跳过预热');
    process.exit(0);
  }

  log(`开始预热 ${urls.length} 张封面图...`);
  let okCount = 0;
  const failed = [];

  // 串行预热：避免一次性并发过多请求给 jsDelivr 造成压力
  for (const url of urls) {
    const r = await warm(url);
    if (r.ok) {
      okCount++;
      log(`OK ${r.status} (attempt ${r.attempt + 1}) ${path.basename(new URL(url).pathname)}`);
    } else {
      failed.push(url);
      log(`FAIL ${r.status} ${url}`);
    }
  }

  log(`预热完成：成功 ${okCount}/${urls.length}`);
  if (failed.length > 0) {
    console.error('以下封面图预热失败：');
    failed.forEach((u) => console.error(' - ' + u));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
