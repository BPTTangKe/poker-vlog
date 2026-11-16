#!/usr/bin/env node
/**
 * 纯 CDP 发推通道（无 Playwright 依赖）
 *
 * 背景：Chrome 157 起，Playwright 1.64 的 connectOverCDP 会因
 * `Browser.setDownloadBehavior: Browser context management is not supported`
 * 直接失败，导致 tweet-to-x.mjs 的 playwright 模式整条不可用。
 * 本脚本绕开 Playwright，直接用 Chrome DevTools Protocol：
 *   Target.createTarget -> Target.attachToTarget(flatten) -> Runtime.evaluate
 * 完成「打开 intent 页 / 校验文案 / 点击 Post / 截图取证」。
 *
 * 用法：
 *   node scripts/tweet-via-cdp.mjs --url "<x intent 链接>"     打开并自动发布
 *   node scripts/tweet-via-cdp.mjs --url "<...>" --dry-run     只校验不点击
 *
 * 退出码：0 = 已发布或 dry-run 校验通过；1 = 失败（未登录/按钮不可用/超时）
 */

const CDP_HTTP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const targetUrl = getArg('--url');
const dryRun = args.includes('--dry-run');
const timeoutMs = Number(getArg('--timeout', '60000'));
const shotPath = getArg('--screenshot');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

function fail(msg) {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`);
  process.exit(1);
}

async function cdpSession() {
  let version;
  try {
    version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  } catch (e) {
    fail(`无法连接 Chrome CDP (${CDP_HTTP})：${e.message}。请以 --remote-debugging-port=9222 启动 Chrome。`);
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).res(m.result ?? m.error);
      pending.delete(m.id);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket error')); });
  return { ws, send, browser: version.Browser };
}

async function evaluate(send, sid, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
  return r?.result?.value;
}

const STATE_EXPR = `(() => {
  const btn = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
  const area = document.querySelector('[data-testid="tweetTextarea_0"]');
  return JSON.stringify({
    url: location.href,
    ready: document.readyState,
    hasButton: !!btn,
    disabled: btn ? btn.getAttribute('aria-disabled') : null,
    hasTextarea: !!area,
    needLogin: new RegExp('(i/flow/login)|(/login)').test(location.href),
    text: area ? area.innerText.slice(0, 120) : null
  });
})()`;

async function main() {
  if (!targetUrl) fail('缺少 --url 参数（X intent 链接）');

  const { ws, send, browser } = await cdpSession();
  log(`已连接 Chrome: ${browser}`);

  const created = await send('Target.createTarget', { url: targetUrl });
  if (!created?.targetId) fail(`创建标签页失败: ${JSON.stringify(created)}`);

  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const sid = attached?.sessionId;
  if (!sid) fail(`附加 CDP 会话失败: ${JSON.stringify(attached)}`);

  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);

  const deadline = Date.now() + timeoutMs;
  let state = null;
  let clicked = false;

  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      state = JSON.parse(await evaluate(send, sid, STATE_EXPR));
    } catch {
      continue;
    }
    log(`状态：button=${state.hasButton} disabled=${state.disabled} textarea=${state.hasTextarea} login=${state.needLogin}`);
    if (state.needLogin) fail('X 未登录：请在 Chrome 中登录后重试（node scripts/tweet-to-x.mjs --login）');
    if (state.hasButton && state.disabled !== 'true' && state.hasTextarea) break;
  }

  if (!state || !state.hasButton) fail('等待超时：未找到发帖按钮');
  if (state.disabled === 'true') fail('发帖按钮始终不可用（文案可能为空或超长）');

  log(`待发布内容预览：${(state.text || '').replace(/\\n/g, ' | ').slice(0, 160)}`);

  if (dryRun) {
    log('dry-run 模式：跳过点击，校验通过');
    ws.close();
    console.log(JSON.stringify({ mode: 'cdp', success: true, dryRun: true, url: state.url }));
    return;
  }

  const clickRes = await evaluate(send, sid, `(() => {
    const b = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
    if (!b) return 'no-button';
    b.click();
    return 'clicked';
  })()`);
  log(`点击结果：${clickRes}`);
  if (clickRes !== 'clicked') fail('点击发帖按钮失败');
  clicked = true;

  // 等待发布完成：按钮消失 / 输入框清空 / 出现 toast 均视为成功信号
  const postDeadline = Date.now() + 30000;
  let posted = false;
  while (Date.now() < postDeadline) {
    await sleep(2000);
    const after = JSON.parse(await evaluate(send, sid, `(() => {
      const area = document.querySelector('[data-testid="tweetTextarea_0"]');
      const empty = !area || !area.innerText.trim();
      return JSON.stringify({ url: location.href, empty, toast: document.body.innerText.includes('Your post was sent') });
    })()`));
    log(`发布校验：url=${after.url} empty=${after.empty} toast=${after.toast}`);
    if (after.empty || after.toast) { posted = true; break; }
  }

  if (shotPath) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      if (shot?.data) {
        const fs = await import('node:fs');
        fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
        log(`截图已保存：${shotPath}`);
      }
    } catch (e) {
      log(`截图失败：${e.message}`);
    }
  }

  ws.close();

  if (!posted) fail('已点击但未确认发布成功（可能被 X 风控拦截，请人工核对）');
  log('发布成功');
  console.log(JSON.stringify({ mode: 'cdp', success: true, clicked, url: state.url }));
}

main().catch((e) => fail(e.message));
