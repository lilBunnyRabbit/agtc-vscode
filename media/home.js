(function () {
  const vscode = acquireVsCodeApi();
  const GLYPH = { claude: "✳", codex: "⬡" };
  const $ = (id) => document.getElementById(id);
  let state = { inactive: [], stats: { today: {}, week: {}, running: 0, repos: [] }, checkouts: [], actions: {} };
  let tool = "claude";
  let painted = "";
  let where = "here";
  let picked;
  const expanded = new Set();
  const PAGE = 15;
  let shown = PAGE;

  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function needHtml(row) {
    const meta = [
      `<span class="repo">${esc(row.repo)}</span>`,
      row.branch ? `<span>⎇ ${esc(row.branch)}</span>` : "",
      row.worktreeName ? `<span>worktree ${esc(row.worktreeName)}</span>` : "",
      `<span>${esc(row.age)} ago</span>`,
    ].filter(Boolean);
    const prompt = row.lastPrompt ? `<div class="said you"><span class="who">you</span><p>${esc(row.lastPrompt)}</p></div>` : "";
    const reply = row.reply ? `<div class="said"><span class="who">${esc(row.tool)}</span><p>${esc(row.reply)}</p></div>` : "";
    return `<article class="session" data-id="${esc(row.id)}">
      <header><span class="glyph">${GLYPH[row.tool] || ""}</span><h3>${esc(row.title)}</h3><button class="primary" data-command="${esc(state.actions.resume.command)}">Resume</button></header>
      <div class="meta">${meta.join("")}</div>
      ${prompt}${reply}
      <footer><button class="link" data-command="${esc(state.actions.copyResume.command)}">copy command</button><button class="link" data-command="${esc(state.actions.openFolder.command)}">open checkout in new window</button><button class="link expand">show all</button></footer>
    </article>`;
  }

  function filtered() {
    const words = $("filter").value.toLowerCase().split(/\s+/).filter(Boolean);
    return state.inactive.filter((row) => words.every((w) => row.search.includes(w)));
  }

  function render() {
    const { stats } = state;
    const rows = filtered();
    $("resume-list").innerHTML = rows.length ? rows.slice(0, shown).map(needHtml).join("") : '<div class="empty">No finished sessions match.</div>';
    for (const el of $("resume-list").querySelectorAll(".session")) {
      if (!expanded.has(el.getAttribute("data-id"))) continue;
      el.classList.add("open");
      el.querySelector(".expand").textContent = "show less";
    }
    $("more").style.display = rows.length > shown ? "" : "none";
    $("more").textContent = `show more (${rows.length - shown} left)`;
    const waiting = stats.repos.reduce((n, r) => n + r.waiting, 0);
    $("summary").textContent = `${stats.running} running · ${waiting} waiting`;
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
    const options = picked && !state.checkouts.some((c) => c.dir === picked.dir) ? [picked, ...state.checkouts] : state.checkouts;
    dir.innerHTML = options.map((c) => `<option value="${esc(c.dir)}">${esc(c.name)}  ·  ${esc(c.path)}</option>`).join("");
    if (current && options.some((c) => c.dir === current)) dir.value = current;
    paths();
  }

  function paths() {
    const dir = $("dir").value;
    const checkout = state.checkouts.find((c) => c.dir === dir) || picked;
    $("dir-path").textContent = checkout ? checkout.path : "";
    const branch = $("branch").value.trim();
    $("branch-path").textContent = branch && checkout ? `${checkout.path}/.claude/worktrees/${branch.replace(/\//g, "+")}` : "a worktree of the checkout's repository, on a new branch";
  }

  $("resume-list").addEventListener("click", (event) => {
    const row = event.target.closest(".session");
    const button = event.target.closest("button");
    if (!row || !button) return;
    const id = row.getAttribute("data-id");
    if (button.classList.contains("expand")) {
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      row.classList.toggle("open", expanded.has(id));
      button.textContent = expanded.has(id) ? "show less" : "show all";
      return;
    }
    vscode.postMessage({ type: "command", command: button.getAttribute("data-command"), id });
  });

  $("filter").addEventListener("input", () => {
    shown = PAGE;
    render();
  });

  $("more").addEventListener("click", () => {
    shown += PAGE;
    render();
  });

  $("tool").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    tool = button.getAttribute("data-tool");
    for (const b of $("tool").querySelectorAll("button")) b.classList.toggle("on", b === button);
  });

  $("where").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    where = button.getAttribute("data-where");
    for (const b of $("where").querySelectorAll("button")) b.classList.toggle("on", b === button);
    $("branch-field").hidden = where !== "worktree";
    if (where === "worktree") $("branch").focus();
  });

  $("dir").addEventListener("change", paths);
  $("branch").addEventListener("input", paths);

  $("browse").addEventListener("click", () => vscode.postMessage({ type: "browse" }));

  function start() {
    const branch = where === "worktree" ? $("branch").value.trim() : "";
    if (where === "worktree" && !branch) {
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
      const next = JSON.stringify(message.state);
      if (next === painted) return;
      painted = next;
      vscode.setState(message.state);
      state = message.state;
      render();
    } else if (message.type === "picked") {
      picked = message.checkout;
      render();
      $("dir").value = picked.dir;
      paths();
    } else if (message.type === "focus") {
      $("task").focus();
    }
  });

  const restored = vscode.getState();
  if (restored) {
    state = restored;
    render();
  }

  vscode.postMessage({ type: "ready" });
  $("task").focus();
})();
