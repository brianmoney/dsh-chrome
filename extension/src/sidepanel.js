// 侧栏：嵌入完整的 dsh 网页界面。顶栏只做四件事——显示桥接状态、
// 提供“停止抓包”的手动夺回按钮、把界面开进普通标签页、打开设置页（改 dsh 地址）。
// 智能体与浏览器的通信由 service worker 的 WebSocket 桥接完成，这里不参与。
//
// 为什么界面留在侧栏里，而不是改成开标签页：browser_* 工具作用在**活动标签页**
// 上。界面一旦占着一个标签页，用户对着智能体说话时那个标签页就是活动页，智能体
// 读到的“当前页面”会是 dsh 界面自己，导航也会打在界面上。侧栏的作用正是让 dsh
// 界面不占标签页，活动页永远是用户真正在看的那一页。
//
// 但侧栏是第三方上下文：dsh 的会话 cookie 是 SameSite=Strict，Chrome 不会把它
// 带进 chrome-extension:// 框架的 WebSocket 握手，所以内嵌界面的实时连接拿不到
// 身份 —— 读得到、写不进（选模型就是典型：列表出得来，选不中）。顶层标签页是
// 第一方上下文，没有这个限制，因此保留“Open in tab”：需要改设置时走那边，
// 平时浏览器工作仍用侧栏。

const frame = document.getElementById("dshFrame");
const stopBtn = document.getElementById("stopCapture");
const settingsBtn = document.getElementById("settings");
const openTabBtn = document.getElementById("openTab");
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

// 交给 service worker 去找已有标签页（有就聚焦，没有就新开），这样“聚焦已有”
// 的逻辑只有一份。
openTabBtn.addEventListener("click", () => {
  panelPort.postMessage({ type: "open-ui" });
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(async () => {
  const stored = await chrome.storage.local.get("dsh_url");
  const url = stored.dsh_url || "http://127.0.0.1:3080";
  frame.src = url;
})();
