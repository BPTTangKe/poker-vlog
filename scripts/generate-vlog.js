#!/usr/bin/env node

/**
 * 自动生成一篇新的 vlog Markdown 文件
 * 使用 OpenAI 兼容 API 生成内容（环境变量配置 API key 和 endpoint）
 *
 * 用法：
 *   node scripts/generate-vlog.js [--topic "主题"]
 *
 * 环境变量：
 *   OPENAI_API_KEY     - API 密钥
 *   OPENAI_BASE_URL    - API 端点（默认 https://api.openai.com/v1）
 *   OPENAI_MODEL       - 模型名称（默认 gpt-4o）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const POKER_TOPICS = [
  'poker-strategy', 'tournament', 'cash-game', 'bankroll',
  'mental-game', 'psychology', 'gto', 'hand-analysis',
  'live-poker', 'online-poker', 'bad-beat', 'bluffing',
];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logError(msg) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR: ${msg}`);
}

/**
 * 使用指定的 API 生成 vlog 内容
 */
async function generateVlogContent(topic) {
  if (!API_KEY) {
    throw new Error('环境变量 OPENAI_API_KEY 未设置');
  }

  const systemPrompt = `你是一名中文德州扑克职业玩家和内容创作者。请撰写一篇 300-500 字的中文德州扑克 vlog 文章。

要求：
- 使用 Markdown 格式，包含标题、副标题、列表等丰富格式
- 内容专业且有趣，融入真实的德州扑克术语（如: 3-bet, C-bet, float, range, EV, tilt, GTO, ICM, SPR, MDF 等）
- 面向有一定基础的扑克玩家
- 有具体的案例或场景
- 以实用的建议或思考结尾
- 全文使用中文`;

  log(`正在调用 ${MODEL} 生成 vlog 内容（主题：${topic}）...`);

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请以"${topic}"为主题撰写一篇德州扑克 vlog 文章。` },
      ],
      temperature: 0.8,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回的内容为空');
  }

  return content;
}

/**
 * 从 Markdown 内容中提取摘要
 */
function extractExcerpt(content) {
  const text = content.replace(/^#.*$/gm, '').replace(/\*\*/g, '').trim();
  const excerpt = text.slice(0, 150).replace(/\n/g, ' ');
  return excerpt + (text.length > 150 ? '...' : '');
}

/**
 * 从内容中提取标签
 */
function extractTags(content, topic) {
  const tags = new Set([topic]);
  const tagMap = {
    '策略': 'poker-strategy',
    '锦标赛': 'tournament',
    '现金': 'cash-game',
    '资金': 'bankroll',
    '情绪': 'mental-game',
    'tilt': 'tilt-control',
    '心理': 'psychology',
    'gto': 'gto',
    '手牌': 'hand-analysis',
    '现场': 'live-poker',
    '线上': 'online-poker',
    'bad beat': 'bad-beat',
    '咋唬': 'bluffing',
  };

  const lower = content.toLowerCase();
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (lower.includes(keyword)) {
      tags.add(tag);
    }
  }

  return [...tags].slice(0, 4);
}

/**
 * 生成 frontmatter
 */
function buildFrontmatter(title, date, excerpt, tags, seoDescription) {
  const tagStr = tags.map(t => `"${t}"`).join(', ');
  return `---
title: "${title}"
date: ${date}
excerpt: "${excerpt}"
tags: [${tagStr}]
image: ""
seo_description: "${seoDescription}"
---`;
}

/**
 * 从内容中提取标题（第一个 # 标题）
 */
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    content = content.replace(match[0], '').trim();
    return match[1].trim();
  }
  return '德州扑克每日策略分享';
}

async function main() {
  const args = process.argv.slice(2);
  let topic = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) {
      topic = args[i + 1];
      break;
    }
  }

  if (!topic) {
    topic = randomPick(POKER_TOPICS);
  }

  log(`开始生成 vlog（主题：${topic}）`);

  try {
    // 生成内容
    const content = await generateVlogContent(topic);

    // 解析内容
    let cleanedContent = content;
    const title = extractTitle(cleanedContent);
    // Remove the title line from content since it goes in frontmatter
    cleanedContent = cleanedContent.replace(/^#\s+.+$/m, '').trim();

    const excerpt = extractExcerpt(cleanedContent);
    const seoDescription = excerpt.slice(0, 150);
    const tags = extractTags(content, topic);

    // 生成文件名和日期
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const slug = slugify(title, dateStr);

    // 组装完整的 markdown 文件
    const frontmatter = buildFrontmatter(title, dateStr, excerpt, tags, seoDescription);
    const fullContent = `${frontmatter}\n\n${cleanedContent}\n`;

    // 写入文件
    const filePath = path.join(VLOG_DIR, `${slug}.md`);
    fs.writeFileSync(filePath, fullContent, 'utf-8');

    log(`vlog 已生成: ${filePath}`);
    log(`标题: ${title}`);
    log(`标签: ${tags.join(', ')}`);
    log(`字数: ${cleanedContent.length}`);

    return { success: true, filePath, title, slug };
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

function slugify(title, dateStr) {
  const slug = title
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 50);
  return slug || `poker-vlog-${dateStr}`;
}

main();
