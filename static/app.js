const STORAGE_KEYS = {
  theme: "theme",
  workspacePath: "workspacePath",
  activeTab: "activeTab",
  activeRepoId: "activeRepoId",
  workingTreeSections: "workingTreeSections",
};

let appConfig = {
  default_workspace: "",
};

const state = {
  repos: [],
  nonGitDirs: [],
  busy: false,
  selecting: false,
  activeRepoId: localStorage.getItem(STORAGE_KEYS.activeRepoId) || null,
  activeTab: localStorage.getItem(STORAGE_KEYS.activeTab) || "dashboard",
  filter: "",
  theme: localStorage.getItem(STORAGE_KEYS.theme) || "light",
  preview: {
    repoId: null,
    path: "",
    scope: "",
    mode: "diff",
    panelMode: "hidden",
    content: "",
    loading: false,
    error: "",
  },
  workingTreeSections: loadWorkingTreeSections(),
};

const pathInput = document.getElementById("pathInput");
const filterInput = document.getElementById("filterInput");
const selectButton = document.getElementById("selectButton");
const scanButton = document.getElementById("scanButton");
const addRepositoryButton = document.getElementById("addRepositoryButton");
const sidebarRepoList = document.getElementById("sidebarRepoList");
const repoDetail = document.getElementById("repoDetail");
const nonGitList = document.getElementById("nonGitList");
const errorBox = document.getElementById("errorBox");
const themeButton = document.getElementById("themeButton");
const tabs = document.querySelectorAll(".rail-button[data-tab]");
const panels = document.querySelectorAll("[data-panel]");

const statusLabels = {
  clean: "干净",
  dirty: "有改动",
  ahead: "待推送",
  behind: "待拉取",
  diverged: "有分叉",
  no_remote: "未连远端",
  error: "异常",
};

const scopeLabels = {
  staged: "已暂存",
  unstaged: "未暂存",
  untracked: "未跟踪",
};

function setBusy(isBusy, repoId = null) {
  state.busy = isBusy;
  state.activeRepoId = repoId || state.activeRepoId;
  render();
}

function setSelecting(isSelecting) {
  state.selecting = isSelecting;
  render();
}

function resetPreview(repoId = null) {
  state.preview = {
    repoId,
    path: "",
    scope: "",
    mode: "diff",
    panelMode: "hidden",
    content: "",
    loading: false,
    error: "",
  };
}

function setPreviewPanelMode(mode) {
  state.preview.panelMode = mode;
}

function loadWorkingTreeSections() {
  const fallback = {
    staged: false,
    unstaged: false,
    untracked: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.workingTreeSections);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return {
      staged: Boolean(parsed.staged),
      unstaged: Boolean(parsed.unstaged),
      untracked: Boolean(parsed.untracked),
    };
  } catch {
    return fallback;
  }
}

function persistWorkspacePath(path) {
  if (path) {
    localStorage.setItem(STORAGE_KEYS.workspacePath, path);
  } else {
    localStorage.removeItem(STORAGE_KEYS.workspacePath);
  }
}

function persistActiveRepoId(repoId) {
  if (repoId) {
    localStorage.setItem(STORAGE_KEYS.activeRepoId, repoId);
  } else {
    localStorage.removeItem(STORAGE_KEYS.activeRepoId);
  }
}

function persistWorkingTreeSections() {
  localStorage.setItem(
    STORAGE_KEYS.workingTreeSections,
    JSON.stringify(state.workingTreeSections)
  );
}

function persistUiState() {
  localStorage.setItem(STORAGE_KEYS.activeTab, state.activeTab);
  persistActiveRepoId(state.activeRepoId);
  persistWorkingTreeSections();
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

async function loadConfig() {
  try {
    const data = await requestJson("/api/config");
    appConfig = {
      default_workspace: (data.default_workspace || "").trim(),
    };
  } catch {
    appConfig = { default_workspace: "" };
  }
}

function updateRepo(repo) {
  state.repos = state.repos.map((item) => (item.id === repo.id ? repo : item));
}

function normalizeFileEntries(entries = [], fallbackScope = "unstaged") {
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        path: entry,
        name: entry.split("/").pop() || entry,
        status: fallbackScope === "untracked" ? "U" : "M",
      };
    }
    return {
      path: entry.path,
      name: entry.name || entry.path.split("/").pop() || entry.path,
      status: entry.status || (fallbackScope === "untracked" ? "U" : "M"),
    };
  });
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
    persistWorkspacePath(path);
    state.repos = data.repos || [];
    state.nonGitDirs = data.non_git_dirs || [];
    const visible = getVisibleRepos();
    const nextRepoId =
      visible.find((repo) => repo.id === state.activeRepoId)?.id ||
      state.repos.find((repo) => repo.id === state.activeRepoId)?.id ||
      visible[0]?.id ||
      state.repos[0]?.id ||
      null;
    state.activeRepoId = nextRepoId;
    persistUiState();
    resetPreview(state.activeRepoId);
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
    const data = await requestJson(`/api/repos/${repoId}/${action}`, {
      method: "POST",
    });
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
    setBusy(false, repoId);
  }
}

async function openRepo(repoId) {
  showError("");
  try {
    await requestJson(`/api/repos/${repoId}/open`, { method: "POST" });
  } catch (error) {
    showError(error.message);
  }
}

async function checkoutRepo(repoId, branch) {
  const repo = state.repos.find((item) => item.id === repoId);
  if (!branch || !repo || branch === repo.branch) {
    return;
  }

  if (
    repo.dirty &&
    !window.confirm(
      `仓库 ${repo.name} 有本地修改，仍要 checkout 到 ${branch} 吗？`
    )
  ) {
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
    }
    if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || "checkout 执行失败");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false, repoId);
  }
}

async function commitRepo(repoId) {
  const input = document.querySelector(`[data-commit-input="${repoId}"]`);
  const message = input?.value.trim() || "";
  if (!message) {
    showError("提交说明还没写。");
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
    if (data.success && input) {
      input.value = "";
    } else if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || "提交没成功");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false, repoId);
  }
}

async function previewFile(repoId, path, scope) {
  state.preview = {
    repoId,
    path,
    scope,
    mode: "diff",
    panelMode: state.preview.panelMode === "full" ? "full" : "split",
    content: "",
    loading: true,
    error: "",
  };
  render();

  try {
    const data = await requestJson(`/api/repos/${repoId}/files/preview`, {
      method: "POST",
      body: JSON.stringify({ path, scope }),
    });
    state.preview = {
      repoId,
      path,
      scope,
      mode: data.mode || "diff",
      panelMode: state.preview.panelMode === "full" ? "full" : "split",
      content: data.content || "",
      loading: false,
      error: data.success ? "" : data.stderr || "预览失败",
    };
  } catch (error) {
    state.preview = {
      repoId,
      path,
      scope,
      mode: "diff",
      panelMode: state.preview.panelMode === "full" ? "full" : "split",
      content: "",
      loading: false,
      error: error.message,
    };
    showError(error.message);
  }

  render();
}

async function runFileAction(repoId, path, action, scope = "") {
  showError("");
  setBusy(true, repoId);
  try {
    const data = await requestJson(`/api/repos/${repoId}/files/action`, {
      method: "POST",
      body: JSON.stringify({ path, action }),
    });
    if (data.repo) {
      updateRepo(data.repo);
    }
    if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || `${action} 执行失败`);
    } else if (action !== "open") {
      resetPreview(repoId);
      if (scope && path) {
        const next = findFileScope(data.repo, path);
        if (next) {
          await previewFile(repoId, path, next);
          return;
        }
      }
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false, repoId);
  }
}

async function runBulkFileAction(repoId, scope, action) {
  showError("");
  setBusy(true, repoId);
  try {
    const data = await requestJson(`/api/repos/${repoId}/files/bulk-action`, {
      method: "POST",
      body: JSON.stringify({ scope, action }),
    });
    if (data.repo) {
      updateRepo(data.repo);
    }
    if (!data.success) {
      const result = data.result || {};
      showError(result.stderr || result.stdout || `${action} 执行失败`);
    } else {
      resetPreview(repoId);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false, repoId);
  }
}

function render() {
  const locked = state.busy || state.selecting;
  selectButton.disabled = locked;
  scanButton.disabled = locked;
  addRepositoryButton.disabled = locked;
  selectButton.textContent = state.selecting ? "选择中" : "选择";
  scanButton.textContent =
    state.busy && !state.activeRepoId ? "扫描中" : "扫描";
  document.documentElement.dataset.theme = state.theme;
  themeButton.classList.toggle("theme-dark", state.theme === "dark");
  themeButton.classList.toggle("theme-light", state.theme !== "dark");
  themeButton.setAttribute(
    "aria-label",
    state.theme === "dark" ? "切回亮色" : "切到夜里"
  );
  themeButton.setAttribute(
    "title",
    state.theme === "dark" ? "切回亮色" : "切到夜里"
  );
  themeButton.dataset.tip = state.theme === "dark" ? "切回亮色" : "切到夜里";
  themeButton.setAttribute(
    "aria-pressed",
    state.theme === "dark" ? "true" : "false"
  );

  renderTabs();
  renderSidebar();
  renderRepoDetail();
  renderNonGit();
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

function renderSidebar() {
  const visibleRepos = getFilteredRepos(getVisibleRepos());
  if (
    visibleRepos.length &&
    !visibleRepos.some((repo) => repo.id === state.activeRepoId)
  ) {
    state.activeRepoId = visibleRepos[0].id;
    persistActiveRepoId(state.activeRepoId);
  }

  if (visibleRepos.length === 0) {
    sidebarRepoList.className = "sidebar-repo-list empty";
    sidebarRepoList.textContent = state.repos.length
      ? "没有匹配的仓库"
      : "尚未扫描";
    return;
  }

  sidebarRepoList.className = "sidebar-repo-list";
  sidebarRepoList.innerHTML = visibleRepos
    .map((repo) => {
      const localBranches = repo.local_branches || [];
      const remoteBranches = repo.remote_branches || [];
      const attentionCount =
        Number(repo.ahead || 0) +
        Number(repo.behind || 0) +
        Number(repo.changed_files || 0) +
        Number(repo.untracked_files || 0);
      const badge =
        repo.status === "clean"
          ? ""
          : `<span class="repo-badge">${attentionCount || 1}</span>`;
      return `
        <button class="sidebar-repo ${
          repo.id === state.activeRepoId ? "active" : ""
        }" type="button" data-repo-id="${repo.id}">
          <span class="repo-dot dot-${escapeHtml(repo.status)}"></span>
          <span class="sidebar-repo-copy">
            <strong>${escapeHtml(repo.name)}</strong>
            <small>${escapeHtml(repo.branch || "-")} · ${
        localBranches.length
      }/${remoteBranches.length}</small>
          </span>
          ${badge}
          <span class="chevron">›</span>
        </button>
      `;
    })
    .join("");
}

function renderRepoDetail() {
  const repo = getActiveRepo();
  if (!repo) {
    repoDetail.innerHTML = `<div class="empty-state">尚未选择仓库</div>`;
    return;
  }

  const isBusy = state.busy && state.activeRepoId === repo.id;
  const anyBusy = state.busy || state.selecting;
  const localBranches = repo.local_branches || [];
  const remoteBranches = repo.remote_branches || [];
  const stagedFiles = normalizeFileEntries(repo.staged_files, "staged");
  const unstagedFiles = normalizeFileEntries(repo.unstaged_files, "unstaged");
  const untrackedFiles = normalizeFileEntries(repo.untracked_list, "untracked");

  const hasPreview =
    state.preview.repoId === repo.id &&
    Boolean(state.preview.path) &&
    state.preview.panelMode !== "hidden";
  const previewMode = hasPreview ? state.preview.panelMode : "hidden";

  repoDetail.innerHTML = `
    <section class="panel action-panel">
      <div class="panel-header action-header">
        <div>
          <h2>${escapeHtml(repo.name)}</h2>
          <p>${escapeHtml(repo.path)}</p>
        </div>
        <span class="status-pill status-${escapeHtml(
          repo.status
        )}">${escapeHtml(statusLabels[repo.status] || repo.status)}</span>
      </div>
      <div class="actions">
        <input data-commit-input="${
          repo.id
        }" type="text" placeholder="提交说明" ${anyBusy ? "disabled" : ""}>
        <button class="primary" type="button" data-action="commit" data-repo-id="${
          repo.id
        }" ${anyBusy ? "disabled" : ""}>提交</button>
        <button type="button" data-action="push" data-repo-id="${repo.id}" ${
    anyBusy ? "disabled" : ""
  }>推送</button>
        <button type="button" data-action="pull" data-repo-id="${repo.id}" ${
    anyBusy ? "disabled" : ""
  }>拉取</button>
        <button type="button" data-action="fetch" data-repo-id="${repo.id}" ${
    anyBusy ? "disabled" : ""
  }>抓取</button>
        <button type="button" data-action="open" data-repo-id="${repo.id}" ${
    anyBusy ? "disabled" : ""
  }>打开</button>
        <button type="button" data-action="refresh" data-repo-id="${repo.id}" ${
    anyBusy ? "disabled" : ""
  }>刷新</button>
      </div>
      ${
        isBusy
          ? `<p class="repo-message">正在处理...</p>`
          : `<p class="repo-message">${escapeHtml(repo.message || "")}</p>`
      }
    </section>

    <section class="panel changes-panel">
      <h2>分支</h2>
      <div class="branch-grid">
        ${branchBlock("本地", localBranches, repo.branch, repo.id, anyBusy)}
        ${branchBlock("远端", remoteBranches, repo.branch, repo.id, anyBusy)}
      </div>
    </section>

    <section class="panel status-panel">
      <div class="panel-header">
        <div>
          <h2>工作区改动</h2>
          <p>点击文件查看预览</p>
        </div>
      </div>
      <div class="working-tree-layout mode-${previewMode}">
        <div class="working-tree-sidebar">
          ${fileListCard({
            title: "已暂存",
            scope: "staged",
            files: stagedFiles,
            anyBusy,
            headerActions: [
              { label: "全部撤回", action: "unstage_all", danger: false },
            ],
            itemActions: ["view", "unstage"],
          })}
          ${fileListCard({
            title: "未暂存",
            scope: "unstaged",
            files: unstagedFiles,
            anyBusy,
            headerActions: [
              { label: "全部暂存", action: "stage_all", danger: false },
              { label: "全部丢弃", action: "discard_all", danger: true },
            ],
            itemActions: ["view", "stage", "discard"],
          })}
          ${fileListCard({
            title: "未跟踪",
            scope: "untracked",
            files: untrackedFiles,
            anyBusy,
            headerActions: [
              { label: "全部加入", action: "add_all", danger: false },
              { label: "全部删除", action: "delete_all", danger: true },
            ],
            itemActions: ["view", "add", "delete", "ignore"],
          })}
        </div>
        ${hasPreview ? previewPanel(repo.id) : ""}
      </div>
    </section>
  `;
}

function renderNonGit() {
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
      `
    )
    .join("");
}

function getActiveRepo() {
  return state.repos.find((repo) => repo.id === state.activeRepoId) || null;
}

function getVisibleRepos() {
  if (state.activeTab === "branches") {
    return state.repos.filter((repo) => {
      const localBranches = repo.local_branches || [];
      const remoteBranches = repo.remote_branches || [];
      return localBranches.length > 1 || remoteBranches.length > 1;
    });
  }
  if (state.activeTab === "repositories") {
    return state.repos.filter((repo) => repo.dirty || repo.untracked);
  }
  if (state.activeTab === "sync") {
    return state.repos.filter((repo) => repo.status !== "clean");
  }
  return state.repos;
}

function getFilteredRepos(repos) {
  const query = state.filter.trim().toLowerCase();
  if (!query) {
    return repos;
  }
  return repos.filter((repo) =>
    `${repo.name} ${repo.path} ${repo.branch}`.toLowerCase().includes(query)
  );
}

function fileListCard({
  title,
  scope,
  files,
  anyBusy,
  headerActions,
  itemActions,
}) {
  const isExpanded = Boolean(state.workingTreeSections[scope]);
  const headerButtons = headerActions
    .map(
      (item) => `
      <button
        class="${item.danger ? "danger" : ""}"
        type="button"
        data-bulk-action="${item.action}"
        data-scope="${scope}"
        ${anyBusy || files.length === 0 ? "disabled" : ""}>
        ${escapeHtml(item.label)}
      </button>
    `
    )
    .join("");

  const content = files.length
    ? buildFileTreeRows(files, scope, itemActions, anyBusy)
    : `<div class="file-list-empty-card">暂时没有</div>`;

  return `
    <section class="file-card ${isExpanded ? "expanded" : "collapsed"}">
      <div class="file-card-header" data-section-toggle="${scope}" aria-expanded="${
    isExpanded ? "true" : "false"
  }">
        <div class="file-card-summary">
          <span class="file-card-label">${escapeHtml(title)}</span>
          <strong class="file-card-count">${files.length}</strong>
        </div>
        <div class="file-card-header-right">
          <div class="file-card-actions">${headerButtons}</div>
          <span class="file-card-toggle">${isExpanded ? "▾" : "▸"}</span>
        </div>
      </div>
      ${isExpanded ? `<div class="file-row-list">${content}</div>` : ""}
    </section>
  `;
}

function buildFileTreeRows(files, scope, itemActions, anyBusy) {
  const root = new Map();

  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      if (!cursor.has(part)) {
        cursor.set(part, {
          type: isLeaf ? "file" : "dir",
          name: part,
          file: isLeaf ? file : null,
          children: isLeaf ? null : new Map(),
        });
      }
      const node = cursor.get(part);
      if (isLeaf) {
        node.file = file;
      } else {
        cursor = node.children;
      }
    });
  });

  return renderTreeNodes(
    Array.from(root.values()),
    scope,
    itemActions,
    anyBusy,
    0
  );
}

function renderTreeNodes(nodes, scope, itemActions, anyBusy, depth) {
  return nodes
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "dir" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((node) => {
      if (node.type === "dir") {
        const children = renderTreeNodes(
          Array.from(node.children.values()),
          scope,
          itemActions,
          anyBusy,
          depth + 1
        );
        return `
          <div class="tree-node">
            <div class="tree-row tree-dir-row" style="--depth:${depth}">
              <span class="tree-caret">▾</span>
              <span class="tree-folder">▸</span>
              <span class="tree-label">${escapeHtml(node.name)}</span>
            </div>
            ${children}
          </div>
        `;
      }
      return fileRow(node.file, scope, itemActions, anyBusy, depth);
    })
    .join("");
}

function fileRow(file, scope, itemActions, anyBusy, depth = 0) {
  const isActivePreview =
    state.preview.repoId === state.activeRepoId &&
    state.preview.path === file.path &&
    state.preview.scope === scope;
  const actions = itemActions
    .map((action) => fileActionButton(action, file, scope, anyBusy))
    .join("");

  return `
    <div class="file-row ${
      isActivePreview ? "active" : ""
    }" data-path="${escapeHtml(
    file.path
  )}" data-scope="${scope}" style="--depth:${depth}">
      <button
        class="file-main"
        type="button"
        data-preview-path="${escapeHtml(file.path)}"
        data-preview-scope="${scope}"
        title="${escapeHtml(file.path)}">
        <span class="tree-spacer"></span>
        <span class="file-main-status">${escapeHtml(file.status)}</span>
        <span class="file-main-copy">
          <span class="file-main-name">${escapeHtml(file.name)}</span>
        </span>
      </button>
      <div class="file-row-actions">${actions}</div>
    </div>
  `;
}

function fileActionButton(action, file, scope, anyBusy) {
  const config = {
    view: { label: "查看", action: "", className: "wt-view" },
    stage: { label: "暂存", action: "stage", className: "wt-stage" },
    discard: {
      label: "丢弃",
      action: "discard",
      className: "danger-text wt-discard",
    },
    unstage: { label: "撤回暂存", action: "unstage", className: "wt-unstage" },
    add: { label: "加入暂存", action: "add", className: "wt-add" },
    delete: {
      label: "删除",
      action: "delete",
      className: "danger-text wt-delete",
    },
    ignore: { label: "忽略", action: "ignore", className: "wt-ignore" },
  }[action];

  if (!config) {
    return "";
  }

  if (action === "view") {
    return `
      <button
        class="file-action-button ${config.className}"
        type="button"
        data-preview-path="${escapeHtml(file.path)}"
        data-preview-scope="${scope}"
        title="${config.label}"
        aria-label="${config.label}">
        <span class="action-icon action-${action}" aria-hidden="true"></span>
      </button>
    `;
  }

  return `
    <button
      class="file-action-button ${config.className}"
      type="button"
      data-file-action="${config.action}"
      data-file-path="${escapeHtml(file.path)}"
      data-file-scope="${scope}"
      title="${config.label}"
      aria-label="${config.label}"
      ${anyBusy ? "disabled" : ""}>
      <span class="action-icon action-${action}" aria-hidden="true"></span>
    </button>
  `;
}

function previewPanel(repoId) {
  const title = `${state.preview.path} · ${
    scopeLabels[state.preview.scope] || state.preview.scope
  }`;
  let body = "";

  if (state.preview.loading) {
    body = `<div class="preview-body empty-state">加载预览中...</div>`;
  } else if (state.preview.error) {
    body = `<div class="preview-body preview-error">${escapeHtml(
      state.preview.error
    )}</div>`;
  } else {
    body = `<div class="preview-body">${renderPreviewContent(
      state.preview
    )}</div>`;
  }

  return `
    <aside class="preview-panel">
      <div class="preview-header">
        <h3>${escapeHtml(title)}</h3>
        <div class="preview-toolbar">
          <button class="preview-toggle ${
            state.preview.panelMode === "split" ? "active" : ""
          }" type="button" data-preview-mode="split">并排看</button>
          <button class="preview-toggle ${
            state.preview.panelMode === "full" ? "active" : ""
          }" type="button" data-preview-mode="full">铺满</button>
          <button class="preview-toggle" type="button" data-preview-mode="hidden">收起</button>
        </div>
      </div>
      ${body}
    </aside>
  `;
}

function renderPreviewContent(preview) {
  const lines = (preview.content || "").split("\n");
  if (!preview.content) {
    return `<div class="empty-state">没有可显示的内容</div>`;
  }

  const rows = lines
    .map((line) => {
      let className = "preview-line";
      if (preview.mode === "diff") {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className += " added";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className += " removed";
        } else if (
          line.startsWith("@@") ||
          line.startsWith("diff --git") ||
          line.startsWith("index ") ||
          line.startsWith("---") ||
          line.startsWith("+++")
        ) {
          className += " meta";
        }
      }
      return `<div class="${className}">${escapeHtml(line) || "&nbsp;"}</div>`;
    })
    .join("");

  return `<div class="preview-code">${rows}</div>`;
}

function branchBlock(label, branches, currentBranch, repoId, disabled) {
  const content = branches.length
    ? branches
        .map((branch) => {
          const isCurrent =
            branch === currentBranch || branch.endsWith(`/${currentBranch}`);
          return `
            <button
              class="branch-chip ${isCurrent ? "active" : ""}"
              type="button"
              data-action="checkout"
              data-repo-id="${repoId}"
              data-branch="${escapeHtml(branch)}"
              ${disabled || isCurrent ? "disabled" : ""}>
              ${escapeHtml(branch)}
            </button>
          `;
        })
        .join("")
    : `<span class="branch-empty">还没有</span>`;

  return `
    <div class="branch-block">
      <span class="branch-label">${escapeHtml(label)}</span>
      <div class="branch-list">${content}</div>
    </div>
  `;
}

function findFileScope(repo, path) {
  if (!repo || !path) {
    return "";
  }
  const staged = normalizeFileEntries(repo.staged_files, "staged");
  if (staged.some((item) => item.path === path)) {
    return "staged";
  }
  const unstaged = normalizeFileEntries(repo.unstaged_files, "unstaged");
  if (unstaged.some((item) => item.path === path)) {
    return "unstaged";
  }
  const untracked = normalizeFileEntries(repo.untracked_list, "untracked");
  if (untracked.some((item) => item.path === path)) {
    return "untracked";
  }
  return "";
}

function getDangerPrompt(action, scope, count, filePath = "") {
  if (action === "discard") {
    return `确认丢弃 ${filePath} 的本地修改吗？`;
  }
  if (action === "delete") {
    return `确认删除 ${filePath} 吗？`;
  }
  if (action === "discard_all") {
    return `确认把这 ${count} 个文件的改动都丢掉吗？`;
  }
  if (action === "delete_all") {
    return `确认把这 ${count} 个未跟踪文件都删掉吗？`;
  }
  return "";
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
addRepositoryButton.addEventListener("click", selectFolder);
themeButton.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEYS.theme, state.theme);
  render();
});
filterInput.addEventListener("input", () => {
  state.filter = filterInput.value;
  render();
});
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    persistUiState();
    render();
  });
});
pathInput.addEventListener("input", () => {
  persistWorkspacePath(pathInput.value.trim());
});
pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    scan();
  }
});

sidebarRepoList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-repo-id]");
  if (!button) {
    return;
  }
  state.activeRepoId = button.dataset.repoId;
  persistActiveRepoId(state.activeRepoId);
  resetPreview(state.activeRepoId);
  render();
});

repoDetail.addEventListener("dblclick", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) {
    return;
  }
  const repo = getActiveRepo();
  if (!repo) {
    return;
  }
  runFileAction(repo.id, row.dataset.path, "open");
});

repoDetail.addEventListener("click", async (event) => {
  const repo = getActiveRepo();
  if (!repo) {
    return;
  }

  const previewClose = event.target.closest("[data-preview-close]");
  if (previewClose) {
    resetPreview(repo.id);
    render();
    return;
  }

  const previewModeTarget = event.target.closest("[data-preview-mode]");
  if (previewModeTarget) {
    const nextMode = previewModeTarget.dataset.previewMode;
    if (nextMode === "hidden") {
      setPreviewPanelMode("hidden");
    } else if (state.preview.path) {
      setPreviewPanelMode(nextMode);
    }
    render();
    return;
  }

  const sectionToggle = event.target.closest("[data-section-toggle]");
  if (sectionToggle) {
    const scope = sectionToggle.dataset.sectionToggle;
    state.workingTreeSections[scope] = !state.workingTreeSections[scope];
    persistWorkingTreeSections();
    render();
    return;
  }

  const previewTarget = event.target.closest("[data-preview-path]");
  if (previewTarget) {
    const nextPath = previewTarget.dataset.previewPath;
    const nextScope = previewTarget.dataset.previewScope;
    const isSamePreview =
      state.preview.repoId === repo.id &&
      state.preview.path === nextPath &&
      state.preview.scope === nextScope &&
      !state.preview.loading;
    if (isSamePreview) {
      setPreviewPanelMode(
        state.preview.panelMode === "hidden" ? "split" : "hidden"
      );
      render();
      return;
    }
    await previewFile(repo.id, nextPath, nextScope);
    return;
  }

  const bulkTarget = event.target.closest("[data-bulk-action]");
  if (bulkTarget) {
    const scope = bulkTarget.dataset.scope;
    const action = bulkTarget.dataset.bulkAction;
    const files =
      scope === "staged"
        ? normalizeFileEntries(repo.staged_files, "staged")
        : scope === "unstaged"
        ? normalizeFileEntries(repo.unstaged_files, "unstaged")
        : normalizeFileEntries(repo.untracked_list, "untracked");
    const prompt = getDangerPrompt(action, scope, files.length);
    if (prompt && !window.confirm(prompt)) {
      return;
    }
    await runBulkFileAction(repo.id, scope, action);
    return;
  }

  const fileActionTarget = event.target.closest("[data-file-action]");
  if (fileActionTarget) {
    const action = fileActionTarget.dataset.fileAction;
    const path = fileActionTarget.dataset.filePath;
    const scope = fileActionTarget.dataset.fileScope;
    const prompt = getDangerPrompt(action, scope, 1, path);
    if (prompt && !window.confirm(prompt)) {
      return;
    }
    await runFileAction(repo.id, path, action, scope);
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const repoId = button.dataset.repoId;
  const action = button.dataset.action;
  if (action === "checkout") {
    checkoutRepo(repoId, button.dataset.branch);
  } else if (action === "open") {
    openRepo(repoId);
  } else if (action === "commit") {
    commitRepo(repoId);
  } else {
    runRepoAction(repoId, action);
  }
});

async function restoreWorkspace() {
  await loadConfig();
  const savedPath = localStorage.getItem(STORAGE_KEYS.workspacePath)?.trim() || "";
  const initialPath = savedPath || appConfig.default_workspace;
  if (!initialPath) {
    render();
    return;
  }
  pathInput.value = initialPath;
  await scan();
}

restoreWorkspace();
