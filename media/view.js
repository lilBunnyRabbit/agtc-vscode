(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const GLYPH = { claude: "✳", codex: "⬡" };
  const ICON = {
    folder: "▣",
    branch: "⎇",
    roots: "⋯",
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
  let state = { groups: [], showInactive: false };
  let selectedId;

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
      row.external ? `<span class="external" title="runs outside this window">⇗</span>` : "",
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
    detail.innerHTML = `<h3 title="${esc(d.title)}">${esc(d.title)}</h3>${items.join("")}`;
  }

  function itemHtml(item, child) {
    const classes = ["item", child ? "child" : "", item.file ? "link" : "", item.icon].filter(Boolean).join(" ");
    const file = item.file ? ` data-file="${esc(item.file)}"` : "";
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
    const item = event.target.closest(".item.link");
    const file = item && item.getAttribute("data-file");
    if (file) vscode.postMessage({ type: "openFile", file });
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
      state = message.state;
      if (message.state.selectedId) selectedId = message.state.selectedId;
      if (selectedId && !rowIds().includes(selectedId)) selectedId = undefined;
      render();
    } else if (message.type === "select") {
      select(message.id, false);
    }
  });

  vscode.postMessage({ type: "ready" });
})();
