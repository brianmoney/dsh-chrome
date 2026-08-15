// dsh-agent 桥接插件（宿主侧）。
//
// 在 dsh web 服务器上注册 WebSocket 升级路由 /dsh-agent/bridge，并对外提供
// `dshAgentBridge` 服务：
//   - call(action, params, timeoutMs)  → 向浏览器扩展发起一次动作并等待结果
//   - onPage(listener) / currentPage() → “当前页面”快照的推送与读取
//     （由页面注入插件消费，注入到最近活跃会话）
//
// 协议（与 extension/src/background.js 对应）：
//   扩展 → dsh：{type:"result", id, ok, result, error} 动作应答
//               {type:"page", tab:{url,title,content}}   页面变化推送
//               {type:"ping"}
//   dsh → 扩展：{type:"action", id, action, params}
//               {type:"pong"}
//
// 安全说明：该路由与 dsh web 的 /api 一样，仅在回环/受信主机上可达；
// 本机任意程序都能连接，这与现有回环信任模型一致。

import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

export const name = "dsh-chrome-bridge";
export const inject = ["webServer", "clientModules"];

export function apply(ctx) {
  const sockets = new Set();
  const pending = new Map(); // id -> { resolve, timer }
  const pageListeners = new Set();
  let currentPage = null;

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => {});
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "ping") {
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch {}
        return;
      }
      if (msg.type === "result") {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve(msg);
        return;
      }
      if (msg.type === "page") {
        const tab = msg.tab && typeof msg.tab === "object" ? msg.tab : null;
        if (!tab || typeof tab.url !== "string") return;
        currentPage = {
          url: tab.url,
          title: typeof tab.title === "string" ? tab.title : "",
          content: typeof tab.content === "string" ? tab.content : "",
          at: Date.now(),
        };
        for (const listener of pageListeners) {
          try {
            listener(currentPage);
          } catch {}
        }
        return;
      }
    });
  });

  const disposer = ctx.webServer.registerUpgrade({
    path: "/dsh-agent/bridge",
    handler: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },
  });

  // 模块图变化（新增/移除插件行）→ 通知扩展自动刷新侧栏里的 dsh 页面。
  // 跳过启动后 5 秒内的初始图构建通知，避免刚连接就刷一次。
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {}
    }
  };
  let graphSettled = false;
  const settleTimer = setTimeout(() => {
    graphSettled = true;
  }, 5000);
  const offGraph = ctx.clientModules.onGraphChanged(() => {
    if (!graphSettled) return;
    broadcast({ type: "graph-changed" });
  });

  ctx.effect(
    () => () => {
      clearTimeout(settleTimer);
      offGraph();
      disposer();
      for (const ws of sockets) ws.terminate();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: "bridge disposed" });
      }
      pending.clear();
    },
    "dsh-agent-bridge: route"
  );

  const bridge = {
    isConnected: () => sockets.size > 0,
    currentPage: () => currentPage,
    onPage(listener) {
      pageListeners.add(listener);
      return () => pageListeners.delete(listener);
    },
    /** 向浏览器扩展发起一次动作（browser_* 工具调用）。 */
    call(action, params = {}, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        const ws = [...sockets].at(-1);
        if (!ws) {
          reject(new Error("browser bridge not connected — open the dsh-chrome side panel (and make sure dsh web is running)"));
          return;
        }
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`browser action ${action} timed out`));
        }, timeoutMs);
        pending.set(id, {
          timer,
          resolve: (m) => {
            if (m.ok === false) {
              reject(new Error(m.error || `browser action ${action} failed`));
            } else {
              resolve(m.result ?? null);
            }
          },
        });
        try {
          ws.send(JSON.stringify({ type: "action", id, action, params }));
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    },
  };

  ctx.provide("dshAgentBridge", bridge);
}
