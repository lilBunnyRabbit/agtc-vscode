(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const GLYPH = { claude: "✳", codex: "⬡" };
  const ICON = {
    folder: "▣",
    branch: "⎇",
    roots: "⋯",
    worktree: "⎇",
    pr: "⇄",
    diff: "±",
    file: "·",
    wait: "!",
    ready: "✓",
    notready: "✗",
    prompt: "❯",
    agents: "◇",
    busy: "◐",
    done: "✓",
  };
  let state = { groups: [], showInactive: false, actions: {} };
  let selectedId;
  let painted = "";

  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function rowIds() {
    return state.groups.flatMap((g) => g.rows.map((r) => r.id));
  }

  function render() {
    if (!state.groups.length) {
      list.innerHTML = '<div class="empty">no sessions</div>';
      detail.innerHTML = "";
      return;
    }
    const html = [];
    for (const group of state.groups) {
      const hot = /input/.test(group.description);
      html.push(`<div class="group">${esc(group.repo)}<span class="count${hot ? " hot" : ""}">${esc(group.description)}</span></div>`);
      for (const row of group.rows) html.push(rowHtml(row));
    }
    list.innerHTML = html.join("");
    applySelection(false);
    renderDetail();
  }

  function rowHtml(row) {
    const wants = row.status === "needs input" || row.status === "done";
    const classes = ["row", row.status.replace(" ", "-"), row.review ? "review" : "", wants ? "wants" : "", row.id === selectedId ? "selected" : ""].filter(Boolean);
    const title = row.review ? "╰ review" : row.title;
    const glyphs = `<span class="glyph">${GLYPH[row.tool] || ""}${row.worktree ? " ⎇" : ""}</span>`;
    const verdict = row.verdict ? `<span class="verdict ${row.verdict.ready ? "ready" : "notready"}">${row.verdict.ready ? "ready" : "not ready"}</span>` : "";
    const meta = [
      `<span class="pill">${esc(row.status)}</span>`,
      verdict,
      row.branch ? `<span class="branch">${esc(row.branch)}</span>` : "",
      row.external ? `<span class="external" title="runs outside tmux">⇗</span>` : "",
    ].filter(Boolean);
    const tooltip = [row.title, row.waitingFor ? `waiting for: ${row.waitingFor}` : "", row.verdict ? `verdict: ${row.verdict.text}` : ""].filter(Boolean).join("\n");
    return `<div class="${classes.join(" ")}" data-id="${esc(row.id)}" data-status="${esc(row.status)}" title="${esc(tooltip)}">
      <span class="digit">${row.digit ?? ""}</span>
      <span class="title">${glyphs}${esc(title)}</span>
      <span class="age">${esc(row.age)}</span>
      <span class="meta">${meta.join("")}</span>
    </div>`;
  }

  function renderDetail() {
    const d = state.detail;
    if (!d || d.id !== selectedId) {
      detail.innerHTML = "";
      return;
    }
    const items = [];
    for (const item of d.items) {
      items.push(itemHtml(item, false));
      for (const child of item.children || []) items.push(itemHtml(child, true));
    }
    const row = state.groups.flatMap((g) => g.rows).find((r) => r.id === d.id);
    const actions = (row ? row.actions : []).map((a) => state.actions[a]);
    const button = (a) => `<button class="${a.kind}" data-command="${esc(a.command)}">${esc(a.label)}</button>`;
    const main = actions.filter((a) => a.kind !== "quiet").map(button).join("");
    const quiet = actions.filter((a) => a.kind === "quiet").map(button).join("");
    detail.dataset.status = d.status;
    detail.innerHTML = `<header><h3>${esc(d.title)}</h3><div class="state"><span class="pill">${esc(d.status)}</span><span>${GLYPH[d.tool] || ""} ${esc(d.tool)}</span><span>${esc(d.age)}</span></div></header>
      <div class="actions">${main}</div>
      <div class="facts">${items.join("")}</div>
      <div class="actions quiet">${quiet}</div>`;
  }

  function itemHtml(item, child) {
    const classes = ["item", child ? "child" : "", item.file || item.url ? "link" : "", item.icon].filter(Boolean).join(" ");
    const file = item.file ? ` data-file="${esc(item.file)}"` : item.url ? ` data-url="${esc(item.url)}"` : "";
    const desc = item.description ? `<span class="desc">${esc(item.description)}</span>` : "";
    return `<div class="${classes}"${file} title="${esc(item.tooltip || item.label)}"><span class="icon">${ICON[item.icon] || ""}</span><span class="label">${esc(item.label)}</span>${desc}</div>`;
  }

  function applySelection(scroll) {
    for (const el of list.querySelectorAll(".row")) el.classList.toggle("selected", el.getAttribute("data-id") === selectedId);
    if (scroll) {
      const el = list.querySelector(".row.selected");
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }

  function select(id, notify) {
    if (!id) return;
    selectedId = id;
    applySelection(true);
    renderDetail();
    if (notify) vscode.postMessage({ type: "select", id });
  }

  function move(delta) {
    const ids = rowIds();
    if (!ids.length) return;
    const index = ids.indexOf(selectedId || "");
    const next = index < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, index + delta));
    select(ids[next], true);
  }

  const command = (name) => vscode.postMessage({ type: "command", command: name, id: selectedId });

  list.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    if (!row) return;
    const id = row.getAttribute("data-id");
    select(id, false);
    vscode.postMessage({ type: "jump", id });
  });

  detail.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) return vscode.postMessage({ type: "command", command: button.getAttribute("data-command"), id: selectedId });
    const item = event.target.closest(".item.link");
    const file = item && item.getAttribute("data-file");
    const url = item && item.getAttribute("data-url");
    if (file) vscode.postMessage({ type: "openFile", file });
    else if (url) vscode.postMessage({ type: "openUrl", url });
  });

  const KEYS = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    j: () => move(1),
    k: () => move(-1),
    Enter: () => selectedId && vscode.postMessage({ type: "jump", id: selectedId }),
    m: () => command("agtc.markSeen"),
    M: () => command("agtc.markAllSeen"),
    c: () => command("agtc.copyResume"),
    o: () => command("agtc.openFolder"),
    a: () => command("agtc.toggleInactive"),
    r: () => command("agtc.refresh"),
    "/": () => command("agtc.search"),
    V: () => command("agtc.review"),
    x: () => command("agtc.closeReviewer"),
    n: () => command("agtc.new"),
    N: () => command("agtc.newWorktree"),
    W: () => command("agtc.moveToWorktree"),
    R: () => command("agtc.resume"),
    t: () => command("agtc.home"),
  };

  list.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const handler = KEYS[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  });

  window.addEventListener("focus", () => list.focus());

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      const next = JSON.stringify(message.state);
      if (next === painted) return;
      painted = next;
      vscode.setState(message.state);
      state = message.state;
      if (message.state.selectedId) selectedId = message.state.selectedId;
      if (selectedId && !rowIds().includes(selectedId)) selectedId = undefined;
      render();
    } else if (message.type === "select") {
      select(message.id, false);
    }
  });

  const restored = vscode.getState();
  if (restored) {
    state = restored;
    selectedId = restored.selectedId;
    render();
  }

  vscode.postMessage({ type: "ready" });
})();
