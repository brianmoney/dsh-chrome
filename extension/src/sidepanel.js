// 侧栏：桥接状态 + 抓包的手动夺回按钮 + 打开设置页。这里不嵌入 dsh 网页界面。
//
// 原因：dsh 的会话 cookie 是 SameSite=Strict（见 dsh 的 dsh-client-connection
// sessionCookie()）。侧栏是第三方上下文——chrome-extension:// 页面里嵌
// http://127.0.0.1:3080——Chrome 不会把这个 cookie 带进该框架的请求，于是嵌入
// 的界面能加载、却始终未通过认证：请求被拒，界面上的改动一律不生效（选模型
// 就是典型症状）。同一地址放进顶层标签页就是第一方上下文，cookie 正常携带，
// 一切正常——所以这里改为让 UI 在标签页里打开。
//
// 扩展其余功能不依赖本面板：桥接、当前页推送、browser_* 工具都在 service
// worker 里（background.js）。

const stopBtn = document.getElementById("stopCapture");
const settingsBtn = document.getElementById("settings");
const openBtn = document.getElementById("openUi");
const statusEl = document.getElementById("status");
const urlHint = document.getElementById("urlHint");

let panelPort = connect();

function connect() {
  const p = chrome.runtime.connect({ name: "panel" });
  p.onMessage.addListener((msg) => {
    if (msg.type === "status") renderStatus(msg);
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

// 由 service worker 去找已有标签页（有就聚焦，没有就新开）；面板不直接开标签页，
// 这样“聚焦已有”的逻辑只有一份。
openBtn.addEventListener("click", () => {
  panelPort.postMessage({ type: "open-ui" });
});

(async () => {
  const stored = await chrome.storage.local.get("dsh_url");
  urlHint.textContent = `Address: ${stored.dsh_url || "http://127.0.0.1:3080"}`;
})();
