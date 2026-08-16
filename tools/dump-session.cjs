// 诊断：打印会话日志里指定 seq 的完整事件 JSON（含 inbox/spliced）。
//
//   node tools/dump-session.cjs <session-file> 341001 341002 …
//   node tools/dump-session.cjs <session-file> 341001-341006   （闭区间）
//
// 不给 seq 时，改为打印一条"有实际文本"的用户消息作为样本。

const { readSessionEvents, loadIntentGate } = require("./session-log.cjs");

(async () => {
  const { textOf } = await loadIntentGate(); // 事件载荷形状只认宿主那一份
  const events = readSessionEvents(process.argv[2]);

  const want = new Set();
  for (const arg of process.argv.slice(3)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(arg);
    if (!m) continue;
    for (let s = Number(m[1]); s <= Number(m[2] ?? m[1]); s++) want.add(s);
  }
  for (const e of events) {
    if (e.seq !== undefined && want.has(e.seq)) {
      console.log("===== seq", e.seq, e.type, "=====");
      console.log(JSON.stringify(e, null, 2).slice(0, 2200));
    }
  }

  if (want.size > 0) return;
  const sample = events.find((e) => e.type === "user/message" && textOf(e).trim().length > 5);
  if (sample) {
    console.log("===== 有文本的 user/message 样本 seq", sample.seq, "=====");
    console.log(JSON.stringify(sample, null, 2).slice(0, 1500));
  }
})();
