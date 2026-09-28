(function () {
  const vscode = acquireVsCodeApi();
  const GLYPH = { claude: "✳", codex: "⬡" };
  const $ = (id) => document.getElementById(id);
  let state = { needs: [], stats: { today: {}, week: {}, running: 0, repos: [] }, checkouts: [], actions: {} };
  let tool = "claude";

  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function needHtml(row) {
    const buttons = row.actions
      .filter((a) => a !== "new" && a !== "newWorktree" && a !== "copyResume")
      .map((a) => `<button data-command="${esc(state.actions[a].command)}">${esc(state.actions[a].label)}</button>`)
      .join("");
    const meta = [`<span class="pill">${esc(row.status)}</span>`, row.branch ? `<span>⎇ ${esc(row.branch)}</span>` : "", row.external ? "<span>⇗ elsewhere</span>" : "", `<span>${esc(row.age)}</span>`].filter(Boolean);
    return `<div class="need" data-id="${esc(row.id)}" data-status="${esc(row.status)}" title="${esc(row.waitingFor ? `waiting for: ${row.waitingFor}` : row.title)}">
      <span class="title">${GLYPH[row.tool] || ""} ${esc(row.title)}</span>
      <span class="meta">${meta.join("")}</span>
      <span class="actions">${buttons}</span>
    </div>`;
  }

  function render() {
    const { needs, stats } = state;
    $("needs-list").innerHTML = needs.length ? needs.map(needHtml).join("") : '<div class="empty">Nothing is waiting on you.</div>';
    $("summary").textContent = `${stats.running} running · ${needs.length} waiting`;
    const card = (big, small) => `<div class="stat"><div class="big">${big}</div><div class="small">${small}</div></div>`;
    $("cards").innerHTML = [
      card(stats.running, "running now"),
      card((stats.today.claude || 0) + (stats.today.codex || 0), `active today · ✳ ${stats.today.claude || 0} ⬡ ${stats.today.codex || 0}`),
      card((stats.week.claude || 0) + (stats.week.codex || 0), `active this week · ✳ ${stats.week.claude || 0} ⬡ ${stats.week.codex || 0}`),
      card(stats.repos.reduce((n, r) => n + r.worktrees, 0), "worktrees in use"),
    ].join("");
    $("repos").innerHTML = stats.repos.length
      ? `<tr><th>repo</th><th>running</th><th>waiting</th><th>worktrees</th><th>sessions</th></tr>` +
        stats.repos
          .map((r) => `<tr><td>${esc(r.repo)}</td><td class="num">${r.running}</td><td class="num${r.waiting ? " hot" : ""}">${r.waiting}</td><td class="num">${r.worktrees}</td><td class="num">${r.sessions}</td></tr>`)
          .join("")
      : "";
    const dir = $("dir");
    const current = dir.value;
    dir.innerHTML = state.checkouts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (current && state.checkouts.includes(current)) dir.value = current;
  }

  $("needs-list").addEventListener("click", (event) => {
    const row = event.target.closest(".need");
    if (!row) return;
    const id = row.getAttribute("data-id");
    const button = event.target.closest("button");
    vscode.postMessage({ type: "command", command: button ? button.getAttribute("data-command") : "agtc.jump", id });
  });

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
  document.addEventListener("keydown", (event) => {
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
    } else if (message.type === "focus") {
      $("task").focus();
    }
  });

  vscode.postMessage({ type: "ready" });
  $("task").focus();
})();
