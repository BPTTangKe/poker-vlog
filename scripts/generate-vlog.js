#!/usr/bin/env node

/**
 * 自动生成一篇新的 vlog Markdown 文件
 * 从 /tmp/poker-vlog-topic.txt 读取主题（由外部定时任务写入），
 * 如果该文件不存在，从内置的 20 个扑克主题列表中随机选择。
 * 基于预设模板生成内容。
 *
 * 用法：
 *   node scripts/generate-vlog.js [--topic "主题"]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VLOG_DIR = path.resolve(__dirname, '..', 'src', 'content', 'vlog');
const TOPIC_FILE = '/tmp/poker-vlog-topic.txt';

const POKER_TOPICS = [
  'Preflop 3-Bet Ranges: When to Light 3-Bet',
  'Mastering C-Bet Frequencies on Dry vs Wet Boards',
  'Bankroll Management: How Many Buy-ins Do You Really Need?',
  'Reading Tells in Live Poker: Eye Movements and Betting Patterns',
  'GTO vs Exploitative Play: Finding the Right Balance',
  'Tilt Control: How I Saved 3 Buy-ins by Walking Away',
  'Tournament ICM: Making Correct Bubble Decisions',
  'Floating the Flop: When and Why to Call Without a Hand',
  'The Mental Game: Dealing with Downswings Like a Pro',
  'Check-Raise Bluffing: Board Textures That Favor the Defender',
  'Online vs Live Poker: Adjusting Your Strategy for Each',
  'Hand Review: The Biggest Pot I Ever Lost (and What I Learned)',
  'Continuation Betting in 3-Bet Pots: Sizing and Frequency',
  'Exploiting Weak Players: How to Maximize Value Against Calling Stations',
  'Block Betting on the River: Thin Value and Bluff Inducers',
  'Multiway Pots: Why You Should Play Tighter Than You Think',
  'Sunday Million Deep Run: Key Hands from My Tournament',
  'From $0.01/$0.02 to $1/$2: My 5-Year Poker Journey',
  'Bad Beats and Variance: The Math That Keeps You Sane',
  'Building a Study Routine: 30 Minutes a Day to Crush Your Stake',
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
 * 读取主题：优先从 /tmp/poker-vlog-topic.txt 读取，不存在则随机选择
 */
function getTopic() {
  try {
    if (fs.existsSync(TOPIC_FILE)) {
      const topic = fs.readFileSync(TOPIC_FILE, 'utf-8').trim();
      if (topic) {
        log(`从 ${TOPIC_FILE} 读取主题: ${topic}`);
        return topic;
      }
    }
  } catch (err) {
    log(`读取 ${TOPIC_FILE} 失败: ${err.message}，使用随机主题`);
  }
  const topic = randomPick(POKER_TOPICS);
  log(`使用随机主题: ${topic}`);
  return topic;
}

/**
 * 基于主题生成 vlog 内容（模板化）
 */
function generateContent(topic) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Template sections based on topic keywords
  const lowerTopic = topic.toLowerCase();
  let intro = '';
  let body = '';
  let conclusion = '';

  if (lowerTopic.includes('3-bet') || lowerTopic.includes('preflop')) {
    intro = `Preflop play is where most money is won or lost before the flop even hits. Today I want to dive deep into 3-bet ranges — specifically, when you should be deviating from standard charts and adding light 3-bets to your arsenal.`;
    body = [
      `## The Standard 3-Bet Range`,
      ``,
      `In a typical 100bb cash game, a standard 3-bet range from the Button vs a CO open looks something like: TT+, AQo+, AJs+, KQs, and some suited connectors like 76s-T9s. This gives you about 6-8% of hands.`,
      ``,
      `But here's the thing — if you only 3-bet this range, observant opponents will quickly adjust. They'll fold everything but premiums, and you'll miss out on significant EV.`,
      ``,
      `## When to Light 3-Bet`,
      ``,
      `**1. Blind vs Blind.** The SB vs BB dynamic is unique — ranges are wide, position matters less postflop. I'll 3-bet up to 15% from the SB, including hands like A5s, K9s, QTs, and small pocket pairs.`,
      ``,
      `**2. vs High Fold-to-3Bet.** If your HUD shows villain folds to 3-bet > 70%, you should be 3-betting relentlessly with any two cards that have decent postflop playability. The immediate fold equity alone is profitable.`,
      ``,
      `**3. Late Position Battles.** CO vs BTN, BTN vs blinds — these spots call for wider 3-bet ranges. I add suited Aces down to A2s, suited Kings down to K8s, and all suited connectors 54s+.`,
      ``,
      `## Sizing Matters`,
      ``,
      `In position: 3x the open is standard. Out of position: go bigger — 4x or even 4.5x. You want to reduce the SPR and neutralize the positional disadvantage.`,
    ].join('\n');
    conclusion = `The key takeaway: your 3-bet range should be fluid, not static. Adjust to your opponent's tendencies and the specific game dynamic. Default to tight, but know when to open up.`;
  } else if (lowerTopic.includes('c-bet') || lowerTopic.includes('continuation')) {
    intro = `The continuation bet is the most frequently used weapon in a poker player's arsenal. But mindlessly c-betting 100% of flops is a leak that costs serious money. Let's break down when to fire and when to check.`;
    body = [
      `## Board Texture Classification`,
      ``,
      `Dry boards (K72r, Q83r): These heavily favor the preflop raiser. If you opened from EP, you have all the strong Kx and Qx. Villain's calling range misses these boards often. C-bet small (25-33% pot) with your entire range.`,
      ``,
      `Wet boards (J❤️T❤️8♠️, 9♠️7♠️5♦️): These connect well with the caller's range. Suited connectors, medium pairs, and draws all find something. Check more often — especially with your medium-strength hands that can't stand a raise.`,
      ``,
      `## The 70/30 Rule`,
      ``,
      `As a baseline: c-bet about 70% on dry flops and 30% on wet flops. This isn't a hard rule, but it keeps you from mindlessly barreling when the board smashes your opponent's range.`,
      ``,
      `## Double Barreling`,
      ``,
      `The turn is where you separate regs from fish. Don't double barrel just because you c-bet. Ask yourself: does this turn card improve my range or villain's range? Cards that complete draws are bad for double barreling. Cards that brick (like an offsuit 2) are great — your uncapped range retains its advantage.`,
    ].join('\n');
    conclusion = `C-betting is about board texture, not your hole cards. Before you auto-click that bet button, take two seconds to evaluate: whose range does this flop favor?`;
  } else if (lowerTopic.includes('bankroll') || lowerTopic.includes('buy-in')) {
    intro = `Bankroll management is the unsexy backbone of professional poker. You can be the best player at the table, but without proper BRM, variance will eventually send you broke. Here's the system I've used to never go busto.`;
    body = [
      `## Cash Game Bankroll Requirements`,
      ``,
      `- **NL2-NL10:** 30-40 buy-ins minimum. Games are soft but you're learning.`,
      `- **NL25-NL50:** 40-50 buy-ins. Win rates drop as you move up. Variance increases.`,
      `- **NL100-NL200:** 50-100 buy-ins. The swings are real. Even 10 buy-in downswings are normal.`,
      ``,
      `## Tournament Bankroll`,
      ``,
      `MTTs require much larger bankrolls due to higher variance:`,
      `- **Low stakes (< $11):** 100-200 buy-ins`,
      `- **Mid stakes ($11-$109):** 200-300 buy-ins`,
      `- **High stakes ($215+):** 300-500 buy-ins`,
      ``,
      `## My Personal System`,
      ``,
      `I keep 50 buy-ins for my main stake (NL200). When the bankroll hits 60 buy-ins, I take a shot at NL500 with 5 buy-ins. If I lose those, I drop back down — no ego, no tilt, just math.`,
      ``,
      `## Stop-Loss Rules`,
      ``,
      `**Per session:** Quit after losing 3 buy-ins. Period. You're not playing your A-game anymore.`,
      `**Per week:** If I'm down 8 buy-ins for the week, I take 2 days off to review hands and reset mentally.`,
    ].join('\n');
    conclusion = `Treat your bankroll like a business asset, not a gambling fund. The players who survive are the ones who manage risk, not the ones who run the hottest.`;
  } else if (lowerTopic.includes('tilt') || lowerTopic.includes('mental')) {
    intro = `Tilt has cost me more money than any bad run of cards ever could. Today I want to share the three most expensive tilt-induced mistakes I've made, and the system I built to stop them from happening again.`;
    body = [
      `## The $2,400 Spew`,
      ``,
      `I was playing NL200, got stacked in a cooler (KK vs AA all-in pre), and immediately reloaded. Within 30 minutes, I'd punted off 8 more buy-ins making hero calls with second pair and shoving with weak draws. Total damage: $2,400 — all because I couldn't handle one bad beat.`,
      ``,
      `## My Tilt Prevention Protocol`,
      ``,
      `**1. The 5-Minute Rule.** After any pot > 100bb where I lose, I sit out for 5 minutes. Stand up, walk around, drink water. Do NOT auto-reload.`,
      ``,
      `**2. Tilt Journal.** I keep a note on my phone. After every session, I rate my emotional state 1-10. If it's below 5, I review what triggered it. Patterns emerge quickly.`,
      ``,
      `**3. Session Hard Stop.** If I say the words "I need to get even" out loud or in my head, I close all tables immediately. This is non-negotiable.`,
      ``,
      `**4. Pre-Session Meditation.** 5 minutes of box breathing before every session. It sounds woo-woo, but it drops my heart rate 10-15 BPM and keeps me calm through coolers.`,
      ``,
      `## Recognizing Tilt Early`,
      ``,
      `Physical signs: faster breathing, tight shoulders, clicking buttons faster.`,
      `Mental signs: thinking "this guy always hits," "the site is rigged," or "I deserve to win this pot."`,
      `When you catch any of these, step away. Your brain is in fight-or-flight mode, and that's terrible for poker decisions.`,
    ].join('\n');
    conclusion = `Tilt management isn't about never getting angry — it's about having a system that catches you before you act on that anger. Build your protocol today, before you need it.`;
  } else if (lowerTopic.includes('gto')) {
    intro = `GTO (Game Theory Optimal) strategy has transformed modern poker. But should you play GTO at the micros? Or is exploitative play still king? Let's break down when to use each approach.`;
    body = [
      `## What GTO Actually Means`,
      ``,
      `GTO doesn't mean "perfect poker." It means a strategy that cannot be exploited — even if your opponent knows exactly what you're doing. It's a defensive baseline that guarantees you won't lose EV against any strategy.`,
      ``,
      `## GTO at Low Stakes`,
      ``,
      `Here's the uncomfortable truth: pure GTO at NL2-NL25 leaves money on the table. Your opponents are making massive fundamental mistakes — calling too wide, folding too much, never bluff-raising rivers. A GTO approach treats them as balanced opponents when they're anything but.`,
      ``,
      `## The Hybrid Approach I Use`,
      ``,
      `**Until I have reads:** Play close to GTO. It's a safe default that keeps you out of trouble.`,
      `**Once reads develop:** Deviate aggressively. Against stations, value bet thinner and never bluff. Against nits, bluff more and fold to their aggression. Against maniacs, trap with strong hands and let them hang themselves.`,
      ``,
      `**Study GTO for defense, not offense.** Use solvers to understand which parts of your range are vulnerable. Plug the leaks. Then go exploit the leaks in everyone else's game.`,
    ].join('\n');
    conclusion = `GTO is a tool, not a religion. Learn it to understand balance, then abandon it to maximize profit against unbalanced opponents. That's where the real money is.`;
  } else if (lowerTopic.includes('tournament') || lowerTopic.includes('icm')) {
    intro = `Tournament poker is a different beast from cash games. The ICM pressure changes everything — especially near the bubble and final table. Here's what I've learned from years of MTT grinding.`;
    body = [
      `## ICM Basics`,
      ``,
      `ICM (Independent Chip Model) converts your chip stack into real money equity based on the prize pool distribution. The key insight: chips gained are worth less than chips lost. This is risk premium.`,
      ``,
      `## Bubble Play`,
      ``,
      `On the bubble, medium stacks should be the tightest. You have the most to lose (a near-guaranteed cash) and the least to gain (you're not going to win the tournament from here).`,
      `Big stacks should apply maximum pressure. Short stacks are desperate. The medium stack is your target — they'll fold everything but premiums.`,
      ``,
      `## Final Table Dynamics`,
      ``,
      `Pay jumps matter more than chips. A ladder up from 5th to 4th might be worth 10-20 buy-ins. Don't risk elimination with marginal spots when a pay jump is imminent.`,
      ``,
      `Conversely, when you're the big stack at a final table, you should be opening 40%+ of hands. The ICM pressure on everyone else is your biggest weapon.`,
    ].join('\n');
    conclusion = `Tournament poker rewards aggression — but only when you understand the ICM implications. Know the risk premium for every decision, and adjust your ranges accordingly.`;
  } else {
    // Default topic template
    intro = `Every session at the poker table teaches something new. Today I want to share a key insight that's been making a real difference in my win rate recently.`;
    body = [
      `## The Concept`,
      ``,
      `Poker is a game of incomplete information. Every decision you make is based on probabilities, not certainties. The players who thrive are the ones who make slightly better decisions, slightly more often, over thousands of hands.`,
      ``,
      `## Practical Application`,
      ``,
      `In practice, this means focusing on the process rather than the outcome. You can make the perfect river call and still lose to a two-outer. That doesn't mean the call was wrong — it means variance happened.`,
      ``,
      `**Key points to remember:**`,
      ``,
      `- Review your hands based on the information available at the time of the decision, not the results`,
      `- Track your all-in EV to separate luck from skill`,
      `- Focus on volume — meaningful patterns only emerge after 10,000+ hands`,
      ``,
      `## Common Mistakes`,
      ``,
      `The biggest mistake I see intermediate players make is result-oriented thinking. They win a pot with a bad play and think they played well. They lose with a good play and think they made a mistake. This feedback loop is poison for improvement.`,
    ].join('\n');
    conclusion = `Trust the math. Trust the process. The results will follow — but only if you put in the volume and stay disciplined.`;
  }

  return `# ${topic}

${intro}

${body}

## Summary

${conclusion}

---

*This vlog is part of the daily Poker Vlog series. For more strategy content, download the BPT App — the best free poker tracker with session logging and bankroll management.*
`;
}

/**
 * 从内容中提取摘要
 */
function extractExcerpt(content) {
  const text = content
    .replace(/^#.*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
  const excerpt = text.slice(0, 160).replace(/\n/g, ' ').trim();
  return excerpt + (text.length > 160 ? '...' : '');
}

/**
 * 从内容中提取标签
 */
function extractTags(content, topic) {
  const tags = new Set();
  const lowerContent = content.toLowerCase();
  const lowerTopic = topic.toLowerCase();

  const tagMap = {
    'preflop': 'preflop',
    '3-bet': '3bet',
    'c-bet': 'cbet',
    'tournament': 'tournament',
    'cash': 'cash-game',
    'bankroll': 'bankroll',
    'tilt': 'mental-game',
    'mental': 'mental-game',
    'psychology': 'psychology',
    'gto': 'gto',
    'hand review': 'hand-analysis',
    'live': 'live-poker',
    'online': 'online-poker',
    'bad beat': 'bad-beat',
    'bluff': 'bluffing',
    'float': 'strategy',
    'icm': 'tournament',
    'position': 'strategy',
    'range': 'strategy',
    'odds': 'math',
    'variance': 'math',
  };

  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (lowerContent.includes(keyword) || lowerTopic.includes(keyword)) {
      tags.add(tag);
    }
  }

  if (tags.size === 0) tags.add('poker-strategy');

  return [...tags].slice(0, 4);
}

function slugify(title, dateStr) {
  let slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 60);
  slug = slug.replace(/-+$/, '');
  return slug || `poker-vlog-${dateStr}`;
}

// 由于 Zod 的 refine 要求 excerpt 不能超过 160 字符，这里必须截断
function escapeYaml(str) {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
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
    topic = getTopic();
  }

  log(`开始生成 vlog（主题：${topic}）`);

  try {
    const content = generateContent(topic);
    const excerpt = extractExcerpt(content);
    const seoDescription = escapeYaml(excerpt.slice(0, 160));
    const tags = extractTags(content, topic);

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const slug = slugify(topic, dateStr);

    // Build frontmatter — 不包含 title 因为 title 从首行 # 提取
    const titleFromContent = topic;

    const frontmatter = [
      '---',
      `title: "${titleFromContent}"`,
      `date: ${dateStr}`,
      `excerpt: "${seoDescription}"`,
      `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
      `image: ""`,
      `seo_description: "${seoDescription}"`,
      '---',
    ].join('\n');

    const fullContent = `${frontmatter}\n\n${content}\n`;

    // Ensure directory exists
    if (!fs.existsSync(VLOG_DIR)) {
      fs.mkdirSync(VLOG_DIR, { recursive: true });
    }

    const filePath = path.join(VLOG_DIR, `${slug}.md`);
    fs.writeFileSync(filePath, fullContent, 'utf-8');

    log(`vlog 已生成: ${filePath}`);
    log(`标题: ${titleFromContent}`);
    log(`标签: ${tags.join(', ')}`);
    log(`字数: ${content.length}`);

    return { success: true, filePath, title: titleFromContent, slug };
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

main();
