(function () {
  const vscode = acquireVsCodeApi();
  const GLYPH = { claude: "✳", codex: "⬡" };
  const $ = (id) => document.getElementById(id);
  let state = { groups: [], checkouts: [], actions: {} };
  let tool = "claude";

  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function rowHtml(row) {
    const wants = row.status === "needs input" || row.status === "done";
    const classes = ["row", row.status.replace(" ", "-"), row.review ? "review" : "", wants ? "wants" : ""].filter(Boolean);
    const title = row.review ? "╰ review" : row.title;
    const glyphs = `<span class="glyph">${GLYPH[row.tool] || ""}${row.worktree ? " ⎇" : ""}</span>`;
    const verdict = row.verdict ? `<span class="verdict ${row.verdict.ready ? "ready" : "notready"}">${row.verdict.ready ? "ready" : "not ready"}</span>` : "";
    const meta = [
      `<span class="pill">${esc(row.status)}</span>`,
      verdict,
      row.branch ? `<span class="branch">${esc(row.branch)}</span>` : "",
      row.external ? `<span class="external" title="runs outside this window">⇗</span>` : "",
    ].filter(Boolean);
    const buttons = row.actions.map((a) => `<button data-command="${esc(state.actions[a].command)}">${esc(state.actions[a].label)}</button>`).join("");
    return `<div class="${classes.join(" ")}" data-id="${esc(row.id)}" data-status="${esc(row.status)}" title="${esc(row.waitingFor ? `waiting for: ${row.waitingFor}` : row.title)}">
      <span class="digit">${row.digit ?? ""}</span>
      <span class="title">${glyphs}${esc(title)}</span>
      <span class="age">${esc(row.age)}</span>
      <span class="meta">${meta.join("")}</span>
      <span class="actions">${buttons}</span>
    </div>`;
  }

  function render() {
    const rows = state.groups.flatMap((g) => g.rows);
    const needs = rows.filter((r) => r.status === "needs input" || r.status === "done");
    $("needs-list").innerHTML = needs.length ? needs.map(rowHtml).join("") : '<div class="empty">nothing waiting</div>';
    const html = [];
    for (const group of state.groups) {
      html.push(`<div class="group">${esc(group.repo)}<span class="count">${esc(group.description)}</span></div>`);
      for (const row of group.rows) html.push(rowHtml(row));
    }
    $("all-list").innerHTML = html.join("") || '<div class="empty">no sessions</div>';
    const dir = $("dir");
    const current = dir.value;
    dir.innerHTML = state.checkouts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (current && state.checkouts.includes(current)) dir.value = current;
  }

  for (const list of [$("needs-list"), $("all-list")]) {
    list.addEventListener("click", (event) => {
      const row = event.target.closest(".row");
      if (!row) return;
      const id = row.getAttribute("data-id");
      const button = event.target.closest("button");
      if (button) vscode.postMessage({ type: "command", command: button.getAttribute("data-command"), id });
      else vscode.postMessage({ type: "command", command: "agtc.jump", id });
    });
  }

  $("tool").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    tool = button.getAttribute("data-tool");
    for (const b of $("tool").querySelectorAll("button")) b.classList.toggle("on", b === button);
  });

  $("wt").addEventListener("change", () => {
    $("branch").disabled = !$("wt").checked;
    if ($("wt").checked) $("branch").focus();
  });

  $("browse").addEventListener("click", () => vscode.postMessage({ type: "browse" }));

  function start() {
    const branch = $("wt").checked ? $("branch").value.trim() : "";
    if ($("wt").checked && !branch) {
      $("note").textContent = "branch name needed";
      $("branch").focus();
      return;
    }
    if (!$("dir").value) {
      $("note").textContent = "pick a checkout";
      return;
    }
    vscode.postMessage({ type: "start", input: { tool, dir: $("dir").value, branch: branch || undefined, task: $("task").value } });
    $("task").value = "";
    $("note").textContent = `starting ${tool}…`;
    setTimeout(() => ($("note").textContent = ""), 4000);
  }

  $("start").addEventListener("click", start);
  $("task").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      start();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      state = message.state;
      render();
    } else if (message.type === "picked") {
      const dir = $("dir");
      if (![...dir.options].some((o) => o.value === message.dir)) dir.add(new Option(message.dir, message.dir), 0);
      dir.value = message.dir;
    }
  });

  vscode.postMessage({ type: "ready" });
  $("task").focus();
})();
