const state = {
  repos: [],
  nonGitDirs: [],
  busy: false,
  selecting: false,
  activeRepoId: null,
};

const pathInput = document.getElementById("pathInput");
const selectButton = document.getElementById("selectButton");
const scanButton = document.getElementById("scanButton");
const repoList = document.getElementById("repoList");
const nonGitList = document.getElementById("nonGitList");
const repoCount = document.getElementById("repoCount");
const nonGitCount = document.getElementById("nonGitCount");
const errorBox = document.getElementById("errorBox");

const statusLabels = {
  clean: "已同步",
  dirty: "有修改",
  ahead: "领先",
  behind: "落后",
  diverged: "分叉",
  no_remote: "无远端",
  error: "错误",
};

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

  if (state.repos.length === 0) {
    repoList.className = "repo-list empty";
    repoList.textContent = "未发现 Git 仓库";
    return;
  }

  repoList.className = "repo-list";
  repoList.innerHTML = state.repos
    .map((repo) => {
      const isBusy = state.busy && state.activeRepoId === repo.id;
      const anyBusy = state.busy || state.selecting;
      return `
        <article class="repo-card">
          <div class="repo-main">
            <div>
              <div class="repo-name-row">
                <h3 class="repo-name">${escapeHtml(repo.name)}</h3>
                <span class="tag">${escapeHtml(repo.branch || "-")}</span>
              </div>
              <p class="repo-path">${escapeHtml(repo.path)}</p>
            </div>
            <span class="tag status-${escapeHtml(repo.status)}">${escapeHtml(statusLabels[repo.status] || repo.status)}</span>
          </div>
          <div class="repo-meta">
            ${metric("Ahead", repo.ahead)}
            ${metric("Behind", repo.behind)}
            ${metric("Remote", repo.has_remote ? "Yes" : "No")}
            ${metric("Dirty", repo.dirty ? "Yes" : "No")}
            ${metric("Untracked", repo.untracked ? "Yes" : "No")}
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
  renderRepos();
  renderNonGit();
}

function metric(label, value) {
  return `
    <div class="metric">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(value)}</span>
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
  if (action === "commit") {
    commitRepo(repoId);
  } else {
    runRepoAction(repoId, action);
  }
});

render();
