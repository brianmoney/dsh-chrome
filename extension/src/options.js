const $ = (id) => document.getElementById(id);

async function load() {
  const stored = await chrome.storage.local.get("dsh_url");
  $("dshUrl").value = stored.dsh_url || "http://127.0.0.1:3080";
}

$("save").addEventListener("click", async () => {
  const url = $("dshUrl").value.trim().replace(/\/+$/, "") || "http://127.0.0.1:3080";
  await chrome.storage.local.set({ dsh_url: url });
  $("saved").textContent = "已保存 — 关闭并重新打开侧栏生效";
});

load();
