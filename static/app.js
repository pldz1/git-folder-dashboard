const state = {
  repos: [],
  nonGitDirs: [],
  busy: false,
  selecting: false,
  activeRepoId: null,
  activeTab: "dashboard",
  expandedRepos: new Set(),
  theme: localStorage.getItem("theme") || "light",
};

const pathInput = document.getElementById("pathInput");
const selectButton = document.getElementById("selectButton");
const scanButton = document.getElementById("scanButton");
const repoList = document.getElementById("repoList");
const nonGitList = document.getElementById("nonGitList");
const repoCount = document.getElementById("repoCount");
const nonGitCount = document.getElementById("nonGitCount");
const errorBox = document.getElementById("errorBox");
const themeButton = document.getElementById("themeButton");
const tabs = document.querySelectorAll("[data-tab]");
const panels = document.querySelectorAll("[data-panel]");
const repoPanelTitle = document.getElementById("repoPanelTitle");
const repoPanelDescription = document.getElementById("repoPanelDescription");
const cleanCount = document.getElementById("cleanCount");
const changedCount = document.getElementById("changedCount");
const aheadCount = document.getElementById("aheadCount");
const behindCount = document.getElementById("behindCount");
const noRemoteCount = document.getElementById("noRemoteCount");

const statusLabels = {
  clean: "已同步",
  dirty: "有修改",
  ahead: "领先",
  behind: "落后",
  diverged: "分叉",
  no_remote: "无远端",
  error: "错误",
};

const tabCopy = {
  dashboard: {
    title: "REPOSITORY STATUS",
    description: "全部仓库默认折叠，优先展示状态和需要处理的差异。",
    empty: "未发现 Git 仓库",
  },
  repositories: {
    title: "REPOSITORIES",
    description: "所有仓库列表，适合快速定位和展开操作。",
    empty: "未发现 Git 仓库",
  },
  branches: {
    title: "BRANCHES",
    description: "只显示存在多个本地或远端分支的仓库。",
    empty: "没有可显示的分支信息",
  },
  sync: {
    title: "SYNC STATUS",
    description: "只显示有修改、领先、落后、分叉、无远端或错误的仓库。",
    empty: "所有仓库都已同步",
  },
};

const primaryMetricLabels = ["AHEAD", "BEHIND", "LOCAL", "REMOTE"];

function setBusy(isBusy, repoId = null) {
  state.busy = isBusy;
  state.activeRepoId = repoId;
  render();
}

function setSelecting(isSelecting) {
  state.selecting = isSelecting;
  render();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || "请求失败");
  }
  return data;
}

function updateRepo(repo) {
  state.repos = state.repos.map((item) => (item.id === repo.id ? repo : item));
}

async function scan() {
  const path = pathInput.value.trim();
  if (!path) {
    showError("请输入父文件夹路径。");
    return;
  }

  showError("");
  setBusy(true);
  try {
    const data = await requestJson("/api/scan", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    state.repos = data.repos || [];
    state.nonGitDirs = data.non_git_dirs || [];
    state.expandedRepos = new Set();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function selectFolder() {
  showError("");
  setSelecting(true);
  try {
    const data = await requestJson("/api/select-folder", { method: "POST" });
    if (data.path) {
      pathInput.value = data.path;
      await scan();
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setSelecting(false);
  }
}

async function runRepoAction(repoId, action) {
  showError("");
  setBusy(true, repoId);
  try {
    const data = await requestJson(`/api/repos/${repoId}/${action}`, { method: "POST" });
    if (data.repo) {
      updateRepo(data.repo);
    }
    if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || `${action} 执行失败`);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function checkoutRepo(repoId, branch) {
  const repo = state.repos.find((item) => item.id === repoId);
  if (!branch || !repo || branch === repo.branch) {
    return;
  }

  if (repo.dirty && !window.confirm(`仓库 ${repo.name} 有本地修改，仍要 checkout 到 ${branch} 吗？`)) {
    return;
  }

  showError("");
  setBusy(true, repoId);
  try {
    const data = await requestJson(`/api/repos/${repoId}/checkout`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    });
    if (data.repo) {
      updateRepo(data.repo);
      state.expandedRepos.add(repoId);
    }
    if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || "checkout 执行失败");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function commitRepo(repoId) {
  const input = document.querySelector(`[data-commit-input="${repoId}"]`);
  const message = input.value.trim();
  if (!message) {
    showError("Commit message 不能为空。");
    return;
  }

  showError("");
  setBusy(true, repoId);
  try {
    const data = await requestJson(`/api/repos/${repoId}/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (data.repo) {
      updateRepo(data.repo);
    }
    if (data.success) {
      input.value = "";
    } else {
      const result = data.result || {};
      showError(result.stderr || result.stdout || "commit 执行失败");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

function renderRepos() {
  repoCount.textContent = String(state.repos.length);
  renderStats();
  const visibleRepos = getVisibleRepos();
  const copy = tabCopy[state.activeTab] || tabCopy.dashboard;
  repoPanelTitle.textContent = copy.title;
  repoPanelDescription.textContent = copy.description;

  if (visibleRepos.length === 0) {
    repoList.className = "repo-list empty";
    repoList.textContent = copy.empty;
    return;
  }

  repoList.className = "repo-list";
  repoList.innerHTML = visibleRepos
    .map((repo) => {
      const isBusy = state.busy && state.activeRepoId === repo.id;
      const anyBusy = state.busy || state.selecting;
      const localBranches = repo.local_branches || [];
      const remoteBranches = repo.remote_branches || [];
      const expanded = state.expandedRepos.has(repo.id);
      const dirtySummary = repo.dirty ? "DIRTY" : "CLEAN";
      const remoteSummary = repo.has_remote ? `${repo.ahead}/${repo.behind}` : "NO REMOTE";
      return `
        <article class="repo-card ${expanded ? "expanded" : "collapsed"}">
          <div class="repo-main">
            <div>
              <div class="repo-name-row">
                <h3 class="repo-name">${escapeHtml(repo.name)}</h3>
                <span class="tag branch-current">${escapeHtml(repo.branch || "-")}</span>
              </div>
              <p class="repo-path">${escapeHtml(repo.path)}</p>
            </div>
            <div class="repo-state">
              <span class="tag status-${escapeHtml(repo.status)}">${escapeHtml(statusLabels[repo.status] || repo.status)}</span>
              <button class="toggle-button" type="button" data-action="toggle" data-repo-id="${repo.id}" aria-expanded="${expanded}">
                ${expanded ? "收起" : "展开"}
              </button>
            </div>
          </div>
          <div class="repo-summary">
            ${summaryItem("SYNC", remoteSummary)}
            ${summaryItem("WORKTREE", dirtySummary)}
            ${summaryItem("BRANCHES", `${localBranches.length} / ${remoteBranches.length}`)}
            ${summaryItem("UNTRACKED", repo.untracked ? "YES" : "NO")}
          </div>
          <div class="repo-details" aria-hidden="${expanded ? "false" : "true"}" ${expanded ? "" : "inert"}>
            <div class="repo-meta">
              ${metric("AHEAD", repo.ahead)}
              ${metric("BEHIND", repo.behind)}
              ${metric("LOCAL", localBranches.length)}
              ${metric("REMOTE", remoteBranches.length)}
              ${metric("UPSTREAM", repo.has_remote ? "YES" : "NO")}
              ${metric("DIRTY", repo.dirty ? "YES" : "NO")}
              ${metric("UNTRACKED", repo.untracked ? "YES" : "NO")}
            </div>
            <div class="branch-grid">
              ${branchBlock("LOCAL", localBranches, repo.branch, repo.id, anyBusy)}
              ${branchBlock("REMOTE", remoteBranches, repo.branch, repo.id, anyBusy)}
            </div>
            <p class="repo-message">${escapeHtml(repo.message || "")}</p>
            <div class="actions">
              <button type="button" data-action="refresh" data-repo-id="${repo.id}" ${anyBusy ? "disabled" : ""}>刷新</button>
              <button type="button" data-action="fetch" data-repo-id="${repo.id}" ${anyBusy ? "disabled" : ""}>Fetch</button>
              <button type="button" data-action="pull" data-repo-id="${repo.id}" ${anyBusy ? "disabled" : ""}>Pull</button>
              <button type="button" data-action="push" data-repo-id="${repo.id}" ${anyBusy ? "disabled" : ""}>Push</button>
            </div>
            <div class="commit-row">
              <input data-commit-input="${repo.id}" type="text" placeholder="Commit message" ${anyBusy ? "disabled" : ""}>
              <button class="primary" type="button" data-action="commit" data-repo-id="${repo.id}" ${anyBusy ? "disabled" : ""}>${isBusy ? "执行中" : "Commit"}</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderNonGit() {
  nonGitCount.textContent = String(state.nonGitDirs.length);

  if (state.nonGitDirs.length === 0) {
    nonGitList.className = "non-git-list empty";
    nonGitList.textContent = "无";
    return;
  }

  nonGitList.className = "non-git-list";
  nonGitList.innerHTML = state.nonGitDirs
    .map(
      (item) => `
        <div class="non-git-item">
          <p class="non-git-name">${escapeHtml(item.name)}</p>
          <p class="non-git-path">${escapeHtml(item.path)}</p>
        </div>
      `,
    )
    .join("");
}

function render() {
  const locked = state.busy || state.selecting;
  selectButton.disabled = locked;
  scanButton.disabled = locked;
  selectButton.textContent = state.selecting ? "选择中" : "选择";
  scanButton.textContent = state.busy && !state.activeRepoId ? "扫描中" : "扫描";
  document.documentElement.dataset.theme = state.theme;
  themeButton.textContent = state.theme === "dark" ? "☀" : "☾";
  themeButton.setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
  renderTabs();
  renderRepos();
  renderNonGit();
}

function renderStats() {
  const clean = state.repos.filter((repo) => repo.status === "clean").length;
  const changed = state.repos.filter((repo) => repo.dirty || repo.untracked).length;
  const ahead = state.repos.filter((repo) => Number(repo.ahead) > 0).length;
  const behind = state.repos.filter((repo) => Number(repo.behind) > 0).length;
  const noRemote = state.repos.filter((repo) => !repo.has_remote).length;

  cleanCount.textContent = String(clean);
  changedCount.textContent = String(changed);
  aheadCount.textContent = String(ahead);
  behindCount.textContent = String(behind);
  noRemoteCount.textContent = String(noRemote);
}

function renderTabs() {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-current", isActive ? "page" : "false");
  });

  panels.forEach((panel) => {
    const visibleTabs = panel.dataset.panel.split(" ");
    panel.hidden = !visibleTabs.includes(state.activeTab);
  });
}

function getVisibleRepos() {
  if (state.activeTab === "branches") {
    return state.repos.filter((repo) => {
      const localBranches = repo.local_branches || [];
      const remoteBranches = repo.remote_branches || [];
      return localBranches.length > 1 || remoteBranches.length > 1;
    });
  }
  if (state.activeTab === "sync") {
    return state.repos.filter((repo) => repo.status !== "clean");
  }
  return state.repos;
}

function summaryItem(label, value) {
  return `
    <div class="summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function metric(label, value) {
  const isPrimary = primaryMetricLabels.includes(label);
  return `
    <div class="metric ${isPrimary ? "metric-primary" : ""}">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function branchBlock(label, branches, currentBranch, repoId, disabled) {
  const content = branches.length
    ? branches
        .map((branch) => {
          const isCurrent = branch === currentBranch || branch.endsWith(`/${currentBranch}`);
          return `
            <button
              class="branch-chip ${isCurrent ? "active" : ""}"
              type="button"
              data-action="checkout"
              data-repo-id="${repoId}"
              data-branch="${escapeHtml(branch)}"
              ${disabled || isCurrent ? "disabled" : ""}
              title="${isCurrent ? "当前分支" : `Checkout ${escapeHtml(branch)}`}">
              ${escapeHtml(branch)}
            </button>
          `;
        })
        .join("")
    : `<span class="branch-empty">NONE</span>`;

  return `
    <div class="branch-block">
      <span class="branch-label">${escapeHtml(label)}</span>
      <div class="branch-list">${content}</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

selectButton.addEventListener("click", selectFolder);
scanButton.addEventListener("click", scan);
themeButton.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  render();
});
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    render();
  });
});
pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    scan();
  }
});

repoList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const repoId = button.dataset.repoId;
  const action = button.dataset.action;
  if (action === "toggle") {
    if (state.expandedRepos.has(repoId)) {
      state.expandedRepos.delete(repoId);
    } else {
      state.expandedRepos.add(repoId);
    }
    render();
  } else if (action === "checkout") {
    checkoutRepo(repoId, button.dataset.branch);
  } else if (action === "commit") {
    commitRepo(repoId);
  } else {
    runRepoAction(repoId, action);
  }
});

render();
