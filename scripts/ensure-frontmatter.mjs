#!/usr/bin/env node
/**
 * 构建前自愈：修复被外部 AIGC 标注工具覆盖掉 frontmatter 的文章。
 *
 * 现象：外部工具会把文件头部的 frontmatter 整块替换成 AIGC 水印块
 * （AIGC: Label/ContentProducer/ProduceID/...），导致 title/date/excerpt 丢失，
 * Astro 构建报 InvalidContentEntryDataError 并中断整站构建。
 *
 * 处理：缺少必需字段时，从文件名与正文重建 frontmatter，同时保留原有的
 * AIGC 水印块（合规标注不丢失）。已有完整 frontmatter 的文件不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VLOG_DIR = path.join(ROOT, 'src', 'content', 'vlog');
const IMG_DIR = path.join(ROOT, 'public', 'images');

const REQUIRED = ['title', 'date', 'excerpt'];

function splitFile(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

function firstHeading(body) {
  const line = body.split(/\r?\n/).find((l) => /^#\s+/.test(l.trim()));
  return line ? line.trim().replace(/^#\s+/, '').trim() : '';
}

function firstParagraph(body) {
  const lines = body.split(/\r?\n/);
  let started = false;
  const buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!started) {
      if (!t || /^#/.test(t)) continue;
      started = true;
    }
    if (!t) break;
    buf.push(t);
  }
  return buf.join(' ');
}

function clip(text, max = 200) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max).trim();
}

function dateFromName(file) {
  const m = file.match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function escapeYaml(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function repair(file) {
  const full = path.join(VLOG_DIR, file);
  const raw = fs.readFileSync(full, 'utf-8');
  const { frontmatter, body } = splitFile(raw);

  const has = (k) => new RegExp(`^${k}\\s*:`, 'm').test(frontmatter);
  const missing = REQUIRED.filter((k) => !has(k));
  if (missing.length === 0) return null;

  const slug = file.replace(/\.md$/, '');
  const title = firstHeading(body) || slug.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-/g, ' ');
  const excerpt = clip(firstParagraph(body) || title);
  const date = dateFromName(file);
  const imgRel = `/images/${slug}.png`;
  const hasImage = fs.existsSync(path.join(IMG_DIR, `${slug}.png`));

  // 保留已有的非必需字段（如 AIGC 水印块），仅补齐缺失的必需字段
  const preserved = frontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const k = (line.match(/^([A-Za-z_][\w-]*)\s*:/) || [])[1];
      return k ? !['title', 'date', 'excerpt', 'tags', 'image', 'seo_description'].includes(k) : line.trim() !== '';
    })
    .join('\n')
    .trim();

  const lines = [];
  lines.push(`title: ${escapeYaml(title)}`);
  lines.push(`date: ${date}`);
  lines.push(`excerpt: ${escapeYaml(excerpt)}`);
  if (has('tags')) {
    const tagsLine = frontmatter.split(/\r?\n/).find((l) => /^tags\s*:/.test(l));
    lines.push(tagsLine.trim());
  } else {
    lines.push('tags: ["poker", "strategy"]');
  }
  if (hasImage) lines.push(`image: ${escapeYaml(imgRel)}`);
  lines.push(`seo_description: ${escapeYaml(excerpt)}`);
  if (preserved) lines.push(preserved);

  const next = `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\s*\n/, '')}`;
  fs.writeFileSync(full, next, 'utf-8');
  return { file, missing, title, date };
}

const files = fs.readdirSync(VLOG_DIR).filter((f) => f.endsWith('.md'));
const fixed = [];
for (const f of files) {
  const r = repair(f);
  if (r) fixed.push(r);
}

if (fixed.length === 0) {
  console.log('[ensure-frontmatter] 全部文章 frontmatter 正常');
} else {
  for (const r of fixed) {
    console.log(`[ensure-frontmatter] 已修复 ${r.file}（缺失 ${r.missing.join('/')}）→ ${r.title}`);
  }
}
