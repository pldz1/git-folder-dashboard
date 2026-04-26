# Local Git Manager

本地 Git 仓库仪表盘。启动后提供一个本地 Web UI，用于扫描工作区目录下的一级子目录，集中查看多个 Git 仓库的状态、分支和同步信息，并执行常用 Git 操作。

## 特性

- 扫描指定父目录下的一级子目录
- 识别包含 `.git` 的 Git 仓库，并列出非 Git 目录
- 显示当前分支、本地分支、远端分支、dirty、untracked、ahead、behind、upstream 状态
- 仓库卡片默认折叠，展开后显示详细指标、分支列表和操作区
- 支持点击分支执行 `git checkout`
- 支持 `fetch`、`pull`、`push`
- 支持 `git add .` + `git commit -m "<message>"`
- 支持 light / dark 主题切换，并保存主题偏好
- 操作后自动刷新仓库状态

## 界面结构

- `Dashboard`：总览视图，包含扫描区、状态统计、仓库列表和非 Git 目录
- `Repositories`：所有 Git 仓库列表
- `Branches`：只显示存在多个本地或远端分支的仓库
- `Sync Status`：只显示需要关注的仓库，例如 dirty、ahead、behind、diverged、no remote 或 error
- `Local Dirs`：只显示扫描到的非 Git 目录

仓库卡片在折叠状态下显示关键信息：仓库名、路径、当前分支、同步状态、工作区状态、分支数量和 untracked 状态。展开后可以查看完整分支列表、详细指标，并执行 Git 操作。

## 项目结构

```text
local-git-manager/
  app.py
  git_service.py
  repo_store.py
  static/
    index.html
    style.css
    app.js
  requirements.txt
  README.md
```

## 安装

创建虚拟环境：

```bash
python -m venv .venv
```

Windows PowerShell 激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

Windows CMD 激活：

```cmd
.venv\Scripts\activate.bat
```

Linux / macOS 激活：

```bash
source .venv/bin/activate
```

安装依赖：

```bash
python -m pip install -r requirements.txt
```

如果 PowerShell 阻止脚本执行，可以在当前窗口临时放开：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 启动

```bash
python app.py
```

默认地址：

```text
http://127.0.0.1:8765
```

默认会自动打开浏览器。若不想自动打开浏览器：

Windows CMD：

```cmd
set LOCAL_GIT_MANAGER_NO_BROWSER=1
python app.py
```

PowerShell：

```powershell
$env:LOCAL_GIT_MANAGER_NO_BROWSER="1"
python app.py
```

Linux / macOS：

```bash
LOCAL_GIT_MANAGER_NO_BROWSER=1 python app.py
```

## Git 操作说明

### Checkout

展开仓库卡片后，可以点击分支 chip 执行 checkout。

- 本地分支：执行 `git checkout <branch>`
- 远端分支：优先创建 tracking branch，执行 `git checkout --track <remote>/<branch>`
- 如果本地已存在同名分支，会切换到本地分支
- 如果工作区有本地修改，前端会先提示确认

### Commit

提交操作会执行：

```bash
git add .
git commit -m "<message>"
```

### Fetch / Pull / Push

操作对应标准 Git 命令：

```bash
git fetch
git pull
git push
```

## API

### `POST /api/scan`

请求：

```json
{
  "path": "D:\\workspace"
}
```

响应：

```json
{
  "success": true,
  "repos": [],
  "non_git_dirs": []
}
```

### `POST /api/select-folder`

打开系统文件夹选择框，返回用户选择的本地路径。

### `GET /api/repos`

返回当前已扫描的仓库列表。

### `POST /api/repos/{id}/refresh`

刷新指定仓库状态。

### `POST /api/repos/{id}/fetch`

执行 `git fetch`。

### `POST /api/repos/{id}/pull`

执行 `git pull`。

### `POST /api/repos/{id}/push`

执行 `git push`。

### `POST /api/repos/{id}/commit`

请求：

```json
{
  "message": "commit message"
}
```

执行：

```bash
git add .
git commit -m "commit message"
```

### `POST /api/repos/{id}/checkout`

请求：

```json
{
  "branch": "main"
}
```

执行本地或远端分支 checkout，并刷新仓库状态。

## 仓库状态

- `clean`：无修改，已同步
- `dirty`：有未提交或未跟踪文件
- `ahead`：本地领先 upstream
- `behind`：本地落后 upstream
- `diverged`：本地和 upstream 都有新提交
- `no_remote`：没有 upstream
- `error`：Git 命令执行失败

## 打包

Windows 下执行：

```bash
pyinstaller --onefile --add-data "static;static" app.py
```

生成的 exe 在 `dist/` 目录中。
