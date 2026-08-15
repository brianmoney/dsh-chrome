// 用真实会话事件验证 currentTurnUserText 修复
const { zstdDecompressSync } = require("node:zlib");
const fs = require("node:fs");

const buf = fs.readFileSync(process.argv[2]);
const starts = [0];
for (let i = 3; i < buf.length; i++) {
  if (buf[i - 3] === 0x28 && buf[i - 2] === 0xb5 && buf[i - 1] === 0x2f && buf[i] === 0xfd) starts.push(i - 3);
}
const frames = [];
for (let k = 0; k < starts.length; k++) {
  const s = starts[k];
  const e = k + 1 < starts.length ? starts[k + 1] : buf.length;
  frames.push(zstdDecompressSync(buf.subarray(s, e)));
}
const text = Buffer.concat(frames).toString("utf8");
const events = [];
for (const l of text.split("\n")) {
  if (!l.trim()) continue;
  try {
    const e = JSON.parse(l);
    if (e && typeof e === "object" && e.type && e.seq !== undefined) events.push(e);
  } catch {}
}

// 与 host/browser-tools.js 完全一致的逻辑
const INTENT_PATTERN = /打开|跳转|点击|导航|浏览一下|新标签|访问|open|navigate|click|visit|tab/i;
function currentTurnUserText(events) {
  const textOf = (e) => {
    const content = e.data?.message?.content ?? e.data?.content ?? [];
    const parts = [];
    for (const block of content) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    return parts.join("\n");
  };
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "turn/start") { start = i; break; }
  }
  const parts = [];
  for (let i = start - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "turn/end") break;
    if (e.type === "user/message" && e.data?.source?.kind === "user") {
      const t = textOf(e);
      if (t) parts.unshift(t);
      break;
    }
  }
  for (let i = start + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "user/message" && e.data?.source?.kind === "user") {
      const t = textOf(e);
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

const joined = currentTurnUserText(events);
console.log("提取文本:", JSON.stringify(joined));
console.log("意图匹配:", INTENT_PATTERN.test(joined));
if (!INTENT_PATTERN.test(joined)) process.exit(1);
