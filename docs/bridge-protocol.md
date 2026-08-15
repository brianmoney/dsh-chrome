# dsh-agent 桥接协议

Chrome 扩展的 service worker 与 dsh 侧的桥接插件（`host/bridge.js`）之间
用 **WebSocket** 通信，路径为 `/dsh-agent/bridge`（挂在 dsh web 服务器上）。
所有消息都是 JSON 文本帧。

## 扩展 → dsh

### `result`
对一个 `action` 的应答。

```jsonc
{ "type": "result", "id": "…", "ok": true, "result": { … } }
{ "type": "result", "id": "…", "ok": false, "error": "没有元素匹配 .foo" }
```

### `page`
页面变化推送（标签切换 / 主框架导航后，防抖约 2 秒）。正文在扩展侧
已按 1MB 保护阀截断。dsh 侧由页面注入器写进最近活跃会话。

```jsonc
{ "type": "page", "tab": { "url": "https://…", "title": "…", "content": "页面正文…" } }
```

### `ping`
保活（约 15 秒一次）；dsh 侧回 `pong`。

## dsh → 扩展

### `action`
浏览器工具发起的动作请求，扩展用 `result` 应答（同 `id`）。

```jsonc
{ "type": "action", "id": "…", "action": "navigate", "params": { "url": "https://…" } }
```

动作：`get_page`、`list_tabs`、`navigate {url}`、`click {selector}`、
`open_tab {url}`、`start_capture`、`stop_capture`、`capture_requests`。

### `pong`
对 `ping` 的应答。

## 智能体侧（dsh 内部，非线上协议）

- `host/browser-tools.js`：注册 `browser_*` 工具；会改变浏览器状态的
  动作需要"本轮用户真实消息含浏览器意图关键词"才放行。
- `host/page-injector.js`：把 `page` 推送写成一条 `source.kind === "plugin"`
  的"当前页面"消息，注入最近活跃会话；这类消息不能解锁浏览器动作。
