// 用真实会话事件验证意图门（host/intent-gate.js）的放行/拦截结果。
//
//   node tools/verify-intent.cjs <session-file>
//
// 判定逻辑全部来自生产模块，本脚本一行都不复刻——两边各自维护副本时曾经
// 漂移，导致这里放行了生产实际拦截的输入。

const { readSessionEvents, loadIntentGate } = require("./session-log.cjs");

(async () => {
  const { currentTurnUserText, isUnlocked } = await loadIntentGate();
  const events = readSessionEvents(process.argv[2]);

  const joined = currentTurnUserText(events);
  console.log("提取文本:", JSON.stringify(joined));
  if (!joined) {
    console.log("（空：本轮没有用户真实消息，或日志里找不到 turn/start——门禁此时失败关闭）");
  }
  console.log("浏览器意图放行:", isUnlocked(events, "browser"));
  console.log("抓包意图放行:", isUnlocked(events, "capture"));
  if (!isUnlocked(events, "browser")) process.exit(1);
})();
