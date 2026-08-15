// dsh-agent service worker。
//
// 职责：
//   1. 与运行中的 dsh web 服务器保持 WebSocket 桥接
//      （ws://<dsh>/dsh-agent/bridge，由 dsh 侧插件注册）。
//   2. 执行 dsh 智能体浏览器工具发来的 `action` 帧
//      （get_page / list_tabs / navigate / click / open_tab / capture_*）。
//   3. 通过 Chrome DevTools 协议（chrome.debugger）抓取活动标签页的
//      HTTP 请求/响应，供智能体读取。
//   4. 监听页面变化（标签切换 / 导航，含 SPA），防抖后把“当前页面”
//      （URL/标题/正文，1MB 保护阀）推给 dsh 侧，由页面注入器写进会话。
//
// 侧栏本身只嵌入 dsh 网页界面；本 worker 是扩展里唯一接触 Chrome API 的部分。

const DEFAULT_DSH_URL = "http://127.0.0.1:3080";

// ---- 配置 / 状态 ----

let dshUrl = DEFAULT_DSH_URL;
let ws = null;
let wsRetry = 2000;
let reconnectTimer = null;
let wasDown = false; // 桥接曾断开：重连后触发侧栏自动刷新（dsh 重启自恢复）

// 每个标签页的抓包状态。
const captures = new Map(); // tabId -> { attached: bool, entries: [], seq }
const MAX_ENTRIES = 500; // 每个标签页保留的请求条数
const MAX_BODY = 1_000_000; // 单个请求/响应体保留的字符数（1MB 保护阀）
const MAX_PAGE = 1_000_000; // 页面正文推送的字符数上限（1MB 保护阀）

// ---- 侧栏通信 ----

const panelPorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  port.onMessage.addListener((msg) => {
    if (msg.type === "capture-stop") stopActiveCapture().catch(reportError);
  });
  broadcastStatus();
});

function toPanel(msg) {
  for (const port of panelPorts) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

function broadcastStatus() {
  const capturing = [...captures.values()].some((c) => c.attached);
  toPanel({
    type: "status",
    kind: ws ? "ok" : "warn",
    text: ws
      ? (capturing ? "桥接已连接 · 正在抓包" : "桥接已连接")
      : "桥接未连接 — dsh web 是否已启动？",
    capturing,
  });
}

function reportError(err) {
  toPanel({ type: "status", kind: "error", text: String(err && err.message ? err.message : err) });
}

// ---- 设置（dsh 地址） ----

async function loadSettings() {
  const stored = await chrome.storage.local.get("dsh_url");
  dshUrl = (stored.dsh_url || DEFAULT_DSH_URL).replace(/\/+$/, "");
}

// ---- WebSocket 桥接 ----

function connectBridge() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  let sock;
  try {
    sock = new WebSocket(`${dshUrl.replace(/^http/, "ws")}/dsh-agent/bridge`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    wsRetry = 2000;
    broadcastStatus();
    // dsh 重启后桥接重连 → 自动刷新侧栏里的 dsh 页面（自我恢复）
    if (wasDown) {
      wasDown = false;
      toPanel({ type: "reload-gui" });
    }
    pushCurrentPage().catch(() => {}); // 桥接恢复时补发一次当前页面
  };
  sock.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "action") handleAction(msg).catch((err) => sendResult(msg.id, false, null, errMsg(err)));
    if (msg.type === "graph-changed") {
      // dsh 模块图变化（安装/移除插件行）→ 让侧栏自动刷新，免手动刷新页面
      toPanel({ type: "reload-gui" });
      return;
    }
    if (msg.type === "pong") return;
  };
  sock.onclose = () => {
    if (ws === sock) {
      ws = null;
      wasDown = true;
    }
    broadcastStatus();
    scheduleReconnect();
  };
  sock.onerror = () => sock.close();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 30000);
}

function sendResult(id, ok, result, error) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "result", id, ok, result, error }));
}

function sendPage(tab) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !tab) return;
  ws.send(JSON.stringify({ type: "page", tab }));
}

// 空闲保活：有活动 WebSocket 时 MV3 的 service worker 不会被挂起，
// ping 同时用于检测连接健康。
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  } else {
    connectBridge();
  }
}, 15000);

// ---- 页面变化监听（当前页面自动推送） ----

let pageTimer = null;
function schedulePagePush() {
  if (pageTimer) clearTimeout(pageTimer);
  pageTimer = setTimeout(() => {
    pageTimer = null;
    pushCurrentPage().catch(() => {});
  }, 2000); // 防抖：快速连续导航只推最后一次
}

chrome.tabs.onActivated.addListener(() => schedulePagePush());
// 含 SPA 路由（history.pushState 等）在内的主框架导航
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) schedulePagePush();
});

async function pushCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = tab && tab.id != null ? tab.id : null;
  if (id == null) return;
  // chrome:// 等内部页面、Chrome 应用商店页等不可注入，直接跳过
  if (tab.url && !/^https?:/i.test(tab.url)) return;
  const page = await scrapeTab(id, MAX_PAGE, 0);
  if (!page) return;
  sendPage({ url: page.url, title: page.title, content: page.text });
}

// ---- 浏览器动作执行器（dsh 的 browser_* 工具调用） ----

function errMsg(e) {
  return String(e && e.message ? e.message : e);
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab && tab.id != null ? tab.id : null;
}

async function needActiveTab() {
  const id = await activeTabId();
  if (id == null) throw new Error("没有活动标签页");
  return id;
}

// 注入式抓取器：get_page 与页面推送共用。
async function scrapeTab(tabId, textLimit, maxLinks) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (textLimit, maxLinks) => ({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, textLimit),
        links: maxLinks
          ? [...document.querySelectorAll("a[href]")].slice(0, maxLinks).map((a) => ({
              text: (a.innerText || "").trim().slice(0, 120),
              href: a.href,
            }))
          : undefined,
      }),
      args: [textLimit, maxLinks],
    });
    return result || null;
  } catch {
    return null; // chrome:// 页面、PDF 查看器等无法注入脚本
  }
}

// 导航加载跟踪：确认导航真正完成，避免抓到旧页面。
function loadTracker(tabId, requireFreshLoad, timeoutMs = 15000) {
  let armed = !requireFreshLoad;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const settle = (ok) => {
    clearTimeout(timer);
    chrome.tabs.onUpdated.removeListener(listener);
    resolveDone(ok);
  };
  const stillPending = (t) => t && (t.pendingUrl || t.url === "about:blank");
  const listener = (id, info, t) => {
    if (id !== tabId) return;
    if (info.status === "loading") armed = true;
    else if (info.url) {
      settle(true);
      return;
    }
    if (info.status === "complete" && armed && !stillPending(t)) settle(true);
  };
  chrome.tabs.onUpdated.addListener(listener);
  const timer = setTimeout(() => settle(false), timeoutMs);
  if (!requireFreshLoad) {
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete" && !stillPending(t)) settle(true);
    }).catch(() => settle(false));
  }
  return () => done;
}

async function handleAction(msg) {
  const p = (msg.params && typeof msg.params === "object") ? msg.params : {};
  switch (msg.action) {
    case "get_page": {
      const id = await needActiveTab();
      const page = await scrapeTab(id, 40000, 400);
      return sendResult(msg.id, true, page, null);
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return sendResult(msg.id, true, tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active })), null);
    }
    case "navigate": {
      const id = await needActiveTab();
      const awaitLoad = loadTracker(id, true);
      await chrome.tabs.update(id, { url: p.url });
      const loaded = await awaitLoad();
      return sendResult(msg.id, true, `已导航到 ${p.url}` + (loaded ? "" : "（15 秒内未确认加载完成）"), null);
    }
    case "click": {
      const id = await needActiveTab();
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { clicked: false, reason: "没有元素匹配 " + sel };
          el.click();
          return { clicked: true, text: (el.innerText || "").trim().slice(0, 120) };
        },
        args: [p.selector],
      });
      if (result && result.clicked) return sendResult(msg.id, true, result, null);
      return sendResult(msg.id, false, null, (result && result.reason) || "点击失败");
    }
    case "open_tab": {
      const tab = await chrome.tabs.create({ url: p.url });
      const loaded = await loadTracker(tab.id, false)();
      return sendResult(msg.id, true, `已打开标签页 ${tab.id}: ${p.url}` + (loaded ? "" : "（15 秒内未确认加载完成）"), null);
    }
    case "start_capture": {
      const id = await needActiveTab();
      await startCapture(id);
      return sendResult(msg.id, true, `已开始抓取标签页 ${id} 的 HTTP 请求/响应（浏览器顶部会出现调试横幅）`, null);
    }
    case "stop_capture": {
      const id = await needActiveTab();
      const stopped = await stopCapture(id);
      return sendResult(msg.id, true, stopped ? "抓包已停止" : "抓包本就没有在运行", null);
    }
    case "capture_requests": {
      const id = await needActiveTab();
      const c = captures.get(id);
      const entries = c ? c.entries.map(({ body, postData, ...rest }) => ({ ...rest, body: body || undefined, postData: postData || undefined })) : [];
      return sendResult(msg.id, true, { tabId: id, capturing: Boolean(c && c.attached), count: entries.length, entries }, null);
    }
    default:
      return sendResult(msg.id, false, null, `未知动作: ${msg.action}`);
  }
}

// ---- HTTP 请求/响应抓包（Chrome DevTools 协议） ----

async function attachDebugger(tabId) {
  if (!captures.get(tabId)?.attached) {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxPostDataSize: 512 * 1024,
    });
  }
}

async function detachDebugger(tabId) {
  const c = captures.get(tabId);
  if (!c || !c.attached) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
}

async function startCapture(tabId) {
  let c = captures.get(tabId);
  if (!c) {
    c = { attached: false, entries: [], seq: 0 };
    captures.set(tabId, c);
  }
  if (c.attached) return;
  await attachDebugger(tabId);
  c.attached = true;
  broadcastStatus();
}

async function stopCapture(tabId) {
  const c = captures.get(tabId);
  if (!c || !c.attached) return false;
  await detachDebugger(tabId);
  c.attached = false;
  broadcastStatus();
  return true;
}

async function stopActiveCapture() {
  const id = await activeTabId();
  if (id != null) await stopCapture(id);
  broadcastStatus();
}

// 标签页关闭时清理，绝不泄漏 debugger 附着。
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const c = captures.get(tabId);
  if (c && c.attached) await detachDebugger(tabId);
  captures.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  const c = captures.get(source.tabId);
  if (c) c.attached = false;
  broadcastStatus();
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const c = captures.get(source.tabId);
  if (!c || !c.attached) return;
  if (method === "Network.requestWillBeSent") {
    const { requestId, request, type, timestamp } = params;
    c.entries.push({
      id: requestId,
      seq: ++c.seq,
      method: request.method,
      url: request.url,
      type,
      postData: request.postData ? request.postData.slice(0, MAX_BODY) : undefined,
      status: null,
      mimeType: null,
      body: null,
      time: timestamp,
    });
    if (c.entries.length > MAX_ENTRIES) c.entries.splice(0, c.entries.length - MAX_ENTRIES);
  } else if (method === "Network.responseReceived") {
    const entry = c.entries.find((e) => e.id === params.requestId);
    if (!entry) return;
    entry.status = params.response.status;
    entry.mimeType = params.response.mimeType;
    entry.redirect = Boolean(params.response.status >= 300 && params.response.status < 400);
  } else if (method === "Network.loadingFinished") {
    const entry = c.entries.find((e) => e.id === params.requestId);
    if (!entry || entry.body || entry.redirect) return;
    try {
      const { body, base64Encoded } = await chrome.debugger.sendCommand(
        { tabId: source.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
      entry.body = (base64Encoded ? "[base64] " + atob(body) : body).slice(0, MAX_BODY);
    } catch {
      entry.body = "(响应体不可用)";
    }
  }
});

// ---- 启动 ----

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// 输入历史内容脚本：注入 dsh 网页界面，给输入框加 ↑/↓ 历史召回。
// 按当前配置的 dsh 地址注册；设置里改地址后自动重注册。
const COMPOSER_SCRIPT_ID = "composer-history";
async function registerComposerHistory() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [COMPOSER_SCRIPT_ID] }).catch(() => {});
    await chrome.scripting.registerContentScripts([
      {
        id: COMPOSER_SCRIPT_ID,
        matches: [`${dshUrl}/*`],
        js: ["src/composer-history.js"],
        runAt: "document_idle",
        allFrames: true,
      },
    ]);
  } catch {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.dsh_url) {
    loadSettings().then(() => registerComposerHistory()).catch(() => {});
  }
});

(async () => {
  await loadSettings();
  registerComposerHistory();
  connectBridge();
})();
