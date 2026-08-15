// 诊断 v2：完整打印指定 seq 附近事件的 JSON（含 inbox/spliced）
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
    if (e && typeof e === "object" && e.type) events.push(e);
  } catch {}
}

// 打印 seq 341001..341006 的完整 JSON
const want = new Set([341001, 341002, 341003, 341004, 341005, 341006]);
for (const e of events) {
  if (e.seq !== undefined && want.has(e.seq)) {
    console.log("===== seq", e.seq, e.type, "=====");
    console.log(JSON.stringify(e, null, 2).slice(0, 2200));
  }
}

// 再找一个"有实际文本"的用户消息样本（更早的轮次）
let sample = null;
for (const e of events) {
  if (e.type === "user/message") {
    const t = (e.data?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    if (t.trim().length > 5) { sample = e; break; }
  }
}
if (sample) {
  console.log("===== 有文本的 user/message 样本 seq", sample.seq, "=====");
  console.log(JSON.stringify(sample, null, 2).slice(0, 1500));
}
