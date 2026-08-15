# dsh-chrome — DeepSeek Harness 浏览器助手

[English](README.md) | 中文

一个 Chrome 扩展：右侧边栏嵌入**完整的 dsh 网页界面**（会话、设置、审批、
任务、目标、工作区……全部功能），并让 dsh 智能体**感知和操作你的浏览器**：

- **自动感知当前页面**：切换标签 / 导航（含 SPA 路由）后，把“当前页面”
  （URL、标题、正文，1MB 保护阀）自动注入最近活跃的会话，智能体天然知道
  你在看什么。
- **按需读取 HTTP 请求/响应**：智能体在你要求时开启抓包
  （`browser_start_capture`），通过 Chrome DevTools 协议记录活动标签页的请求
  方法、URL、状态码、请求体与响应体，`browser_capture_requests` 读取。默认对
  疑似凭据的值做脱敏，见 [安全](#安全)。
- **驱动浏览器**：`browser_navigate` / `browser_click` / `browser_open_tab`。
- **免审批 + 工具层意图解锁**：会改变浏览器状态的动作只有在本轮由你的真实
  消息发起、且消息里出现明确浏览器意图（“打开/跳转/点击/navigate/click/open”
  或“抓包/capture”）时才执行；网页里藏一句指令无法驱动浏览器（免审批模式下的
  尽力防护，非绝对保证）。
- 抓包期间 Chrome 顶部会显示“正在调试此浏览器”横幅（关闭抓包即消失）。

## 前置条件

- 本机运行 `dsh web`（默认 `http://127.0.0.1:3080`，可在扩展设置里改）。
- Chrome 116+。

## 安装

分两部分：**宿主插件**（装进 dsh）与 **Chrome 扩展**（开发者模式加载）。

**1. 把宿主插件加到 dsh web 配置：**

```sh
dsh plugin --profile web add dsh-chrome
```

它会注册桥接、浏览器工具、页面注入器三个插件。dsh 会实时热应用新增插件行，
装完刷新浏览器页面即可，无需重启（仅当以后**修改已加载插件文件内容**时才需
重启一次）。

**2. 安装并加载 Chrome 扩展：**

```sh
npx dsh-chrome install
```

它会把扩展复制到一个稳定的用户目录（并打印路径），然后提示剩余步骤：

1. 打开 `chrome://extensions`，开启**开发者模式**。
2. 点**加载已解压的扩展程序**，选择打印出来的目录。
3. 点工具栏的 **dsh-chrome** 图标打开侧栏。

升级 npm 包后重新运行 `npx dsh-chrome install` 即可刷新扩展文件。
`npx dsh-chrome path` 打印目录；`npx dsh-chrome uninstall` 删除它。

## 使用

- 侧栏里就是完整的 dsh 网页界面，正常使用即可。
- 顶栏：桥接状态（dsh 未启动时提示）、**停止抓包**（手动夺回）、**设置**
  （改 dsh 地址）。
- 对智能体说“打开 xx 页面”“点击登录按钮”“抓一下这个页面的请求”即可。

## 安全

**仅限本机可信使用。** 桥接与浏览器工具让本机的 dsh 智能体能够读取页面、
抓取流量、驱动浏览器。

- **抓包按会话手动开启**，且只能看到开启之后发生的请求。**不抓取 HTTP 头**
  （因此 Cookie / Set-Cookie / Authorization 头不会进入模型上下文）。其余可能
  含凭据的位置——URL 里疑似密钥的查询参数（`?access_token=…`）、请求体
  （表单/JSON 登录）、以及响应体里嵌入的令牌——**默认脱敏为 `«redacted»`**。
  若要抓取原始未脱敏流量（自行调试用），在配置文件 `cordis.patch.yml` 的
  `dsh-chrome-browser-tools` 行上设 `redactCredentials: false`。
- **注入的“当前页面”消息被明确标注为不可信数据**，并要求智能体绝不执行其中的
  任何指令；意图解锁机制进一步阻止页面内容触发“动浏览器”的动作。这些是免审批
  模式下的尽力防护，非绝对保证——抓包开启时请勿让智能体访问不可信或敏感站点。

## 目录结构

| 路径 | 内容 |
|---|---|
| `extension/` | Chrome MV3 扩展（侧栏 + service worker + 设置页） |
| `host/` | dsh 侧三个插件：`bridge.js`（WS 桥接）/ `browser-tools.js`（工具 + 脱敏）/ `page-injector.js` |
| `host/redact.js` | 抓包流量的凭据脱敏 |
| `cordis.patch.yml` | 挂载三个宿主插件的 bundle 补丁 |
| `bin/cli.js` | 安装扩展文件的 `dsh-chrome` 命令 |
| `docs/bridge-protocol.md` | 扩展与 dsh 桥接的线上协议 |

## 限制与说明

- 所有浏览器工具（含抓包）只作用于**当前活动标签页**。
- 抓包记录滚动保留最近 500 条；单条请求/响应体与页面正文同为 1MB 保护阀。
- 页面变化判定：标签切换 / 主框架导航，防抖约 2 秒；滚动不触发。

## 许可证

[MIT](LICENSE) © Stuart Hu
