// 侧栏：嵌入完整的 dsh 网页界面。顶栏只做三件事——显示桥接状态、
// 提供“停止抓包”的手动夺回按钮、打开设置页（改 dsh 地址）。
// 智能体与浏览器的通信由 service worker 的 WebSocket 桥接完成，这里不参与。

const frame = document.getElementById("dshFrame");
const stopBtn = document.getElementById("stopCapture");
const settingsBtn = document.getElementById("settings");
const statusEl = document.getElementById("status");

let panelPort = connect();

function connect() {
  const p = chrome.runtime.connect({ name: "panel" });
  p.onMessage.addListener((msg) => {
    if (msg.type === "status") renderStatus(msg);
    if (msg.type === "reload-gui") {
      // dsh 模块图变化（装了新插件）→ 自动刷新嵌入的 dsh 页面
      try {
        frame.src = frame.src;
      } catch {}
    }
  });
  p.onDisconnect.addListener(() => {
    panelPort = connect();
  });
  return p;
}

function renderStatus(s) {
  statusEl.textContent = s.text || "";
  statusEl.dataset.kind = s.kind || "";
}

stopBtn.addEventListener("click", () => {
  panelPort.postMessage({ type: "capture-stop" });
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(async () => {
  const stored = await chrome.storage.local.get("dsh_url");
  const url = stored.dsh_url || "http://127.0.0.1:3080";
  frame.src = url;
})();
