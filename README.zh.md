# dsh-chrome — DeepSeek Harness 浏览器助手

[English](README.md) | 中文

一个 Chrome 扩展：右侧边栏嵌入**完整的 dsh 网页界面**（会话、设置、审批、
任务、目标、工作区……全部功能），并让 dsh 智能体**感知和操作你的浏览器**：

- **自动感知当前页面**：切换标签 / 导航（含 SPA 路由）后，把“当前页面”
  （URL、标题、正文，上限 1,000,000 字符）自动注入最近活跃的会话，智能体
  天然知道你在看什么。只有 `http(s)` 标签页会被自动注入。
- **按需读取 HTTP 请求/响应**：智能体在你要求时开启抓包
  （`browser_start_capture`），通过 Chrome DevTools 协议记录活动标签页的请求
  方法、URL、状态码、请求体与响应体，`browser_capture_requests` 读取。默认对
  疑似凭据的值做脱敏，见 [安全](#安全)。
- **驱动浏览器**：`browser_navigate` / `browser_click` / `browser_open_tab`。
- **免审批 + 工具层意图解锁**：会改变浏览器状态的动作只有在本轮由你的真实
  消息发起、且消息里出现明确浏览器意图时才执行。解锁
  `browser_navigate` / `browser_click` / `browser_open_tab` 的词是
  **打开 / 跳转 / 前往 / 点击 / 导航 / 访问 / 浏览一下 / 新标签**
  （英文 open、navigate、click、visit、tab，以及后面跟着页面或 URL 的
  “go to”——`go to github.com` 可以，光说 `go to the next step` 不行）；解锁
  `browser_start_capture` 的词是 **抓包 / 抓一下 / 抓取请求 / 监听网络 /
  网络请求 / 流量**（英文 capture、debug）。
  **注意：单独说「抓取」不会开启抓包**——它是普通的“读取”意图，请改说
  「抓包」或「抓取请求」。
  网页里藏一句指令无法驱动浏览器（免审批模式下的尽力防护，非绝对保证）。
- 抓包期间 Chrome 顶部会显示“正在调试此浏览器”横幅（关闭抓包即消失）。

## 前置条件

- 本机运行 `dsh web`（默认 `http://127.0.0.1:3080`，可在扩展设置里改）。
- Chrome 118+（扩展用到 Chrome 118 起才有的 `InjectionResult.error`）。

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

**升级 npm 包后要重新运行 `npx dsh-chrome install`**，再到 `chrome://extensions`
点一次“重新加载”——安装是复制文件，少做任何一步，Chrome 都还在用旧版扩展
配新版宿主插件。`npx dsh-chrome path` 打印目录。

要彻底移除 dsh-chrome，两半都要撤：`npx dsh-chrome uninstall` 删除扩展目录
（再到 `chrome://extensions` 里移除），`dsh plugin --profile web remove dsh-chrome`
卸掉宿主插件。

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
  - 脱敏是**尽力而为，非保证**：按常见键名匹配密钥，因此不常见键名下的密钥、
    URL 路径里的密钥、或无法解析/被截断的请求响应体里的密钥仍可能漏过。
    **请把抓到的流量当作敏感数据对待**，只对信任的站点开启抓包。
- **注入的“当前页面”消息被明确标注为不可信数据**，并要求智能体绝不执行其中的
  任何指令；意图解锁机制进一步阻止页面内容触发“动浏览器”的动作。这些是免审批
  模式下的尽力防护，非绝对保证——抓包开启时请勿让智能体访问不可信或敏感站点。

## 目录结构

| 路径 | 内容 |
|---|---|
| `extension/` | Chrome MV3 扩展（侧栏 + service worker + 设置页） |
| `host/` | dsh 侧三个插件：`bridge.js`（WS 桥接）/ `browser-tools.js`（工具 + 脱敏）/ `page-injector.js` |
| `host/redact.js` | 抓包流量的凭据脱敏 |
| `host/intent-gate.js` | 意图解锁关键词与本轮用户文本提取（与 `tools/verify-intent.cjs` 共用） |
| `cordis.patch.yml` | 挂载三个宿主插件的 bundle 补丁 |
| `bin/cli.js` | 安装扩展文件的 `dsh-chrome` 命令 |
| `docs/bridge-protocol.md` | 扩展与 dsh 桥接的线上协议 |

## 限制与说明

- 读取或操作页面状态的浏览器工具（含抓包）只作用于**当前活动标签页**；
  `browser_list_tabs` 与 `browser_open_tab` 按其性质除外。
- 抓包记录滚动保留最近 500 条；单条请求/响应体与自动注入的页面正文上限同为
  1,000,000 字符。按需读取的 `browser_get_page` 是**另一套更小的限额**：
  约 40,000 字符正文、最多 400 条链接。
- 页面变化判定：标签切换 / 主框架导航 / SPA 路由变化（`history.pushState`），
  防抖约 2 秒；滚动不触发。此外桥接每次重连成功后会补推一次当前页面。
- `browser_click` 绝不重试：若点击导致页面导航、结果丢失，工具会报
  `clicked: "unknown"` 而不是再点一次（点击不是幂等操作），并提示智能体用
  `browser_get_page` 复核页面状态。
- **扩展自身的侧栏界面目前仅有中文**（顶栏那几个标签：桥接状态、“停止抓包”、
  设置）。内嵌的 dsh 网页界面跟随 dsh 自己的语言设置；只有这层很薄的扩展外壳
  尚未翻译，计划在后续版本补上。
- **读取 `chrome-extension://` 页面**（例如其它扩展的设置页）：`chrome.scripting`
  与 `chrome.debugger` 都无法跨扩展访问（都会抛「Cannot access a
  chrome-extension:// URL of different extension」），因此普通注入失败时，
  worker 会回退到浏览器的**远程调试协议**（`http://127.0.0.1:9222`）。这要求
  浏览器以 `--remote-debugging-port=9222` 启动（若远程端点做 Origin 校验，
  还需 `--remote-allow-origins=chrome-extension://<本扩展ID>`）。当 CDP 端点
  缺失或不可达时，读取这类页面会直接报错并指明该启动参数，而不是悄悄返回空。
  该回退只用于按需的 `browser_get_page` / `browser_click`；普通页面不会走这条
  路径，自动注入的“当前页面”也只覆盖 `http(s)` 标签页。

## 许可证

[MIT](LICENSE) © Stuart Hu
