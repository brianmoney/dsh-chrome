// 读取 dsh 会话日志（zstd 分帧的 NDJSON）。
//
// dump-session.cjs 与 verify-intent.cjs 都要解这个格式，这里是唯一实现——
// 它编码的是 dsh 未公开的落盘格式，两份副本意味着下次格式变动只会被改一处。

const { zstdDecompressSync } = require("node:zlib");
const fs = require("node:fs");

/** 按 zstd 魔数（28 b5 2f fd）切帧、解压、逐行解析 JSON，返回事件数组。 */
function readSessionEvents(path) {
  const buf = fs.readFileSync(path);
  const starts = [];
  for (let i = 3; i < buf.length; i++) {
    if (buf[i - 3] === 0x28 && buf[i - 2] === 0xb5 && buf[i - 1] === 0x2f && buf[i] === 0xfd) {
      starts.push(i - 3);
    }
  }
  // 日志正常以魔数开头，扫描就会给出 0；只有在文件不是从帧边界开始时才需要
  // 补一个 0（旧写法无条件预置 0，于是每次都多解压一个零长度的“帧”）。
  if (starts[0] !== 0) starts.unshift(0);
  const frames = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] : buf.length;
    frames.push(zstdDecompressSync(buf.subarray(s, e)));
  }
  const events = [];
  for (const line of Buffer.concat(frames).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === "object" && ev.type) events.push(ev);
    } catch {}
  }
  return events;
}

/** 加载宿主侧的意图门模块（ESM → CJS 动态 import）。 */
function loadIntentGate() {
  return import("../host/intent-gate.js");
}

module.exports = { readSessionEvents, loadIntentGate };
