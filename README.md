# Local Git Manager

Windows 本地 Git 仓库管理工具。运行 Python 服务后会启动本地 Web UI，用于扫描父目录下的一级子目录，识别 Git 仓库并执行常用 Git 操作。

## 功能

- 扫描指定父目录下的一级子目录
- 支持通过系统文件夹选择框选择扫描路径
- 识别包含 `.git` 的 Git 仓库
- 显示分支、dirty、untracked、remote、ahead、behind 和状态
- 支持 `fetch`、`pull`、`push`
- 支持 `git add .` + `git commit -m "<message>"`
- 操作后自动刷新仓库状态

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

## 创建虚拟环境

在项目目录执行：

```bash
python -m venv .venv
```

PowerShell 激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

CMD 激活：

```cmd
.venv\Scripts\activate.bat
```

如果 PowerShell 阻止脚本执行，可以在当前窗口临时放开：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 安装依赖

```bash
python -m pip install -r requirements.txt
```

## 启动

```bash
python app.py
```

默认地址：

```text
http://127.0.0.1:8765
```

启动后会自动打开浏览器。若不想自动打开浏览器：

```bash
set LOCAL_GIT_MANAGER_NO_BROWSER=1
python app.py
```

PowerShell：

```powershell
$env:LOCAL_GIT_MANAGER_NO_BROWSER="1"
python app.py
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

响应：

```json
{
  "success": true,
  "path": "D:\\workspace"
}
```

### `GET /api/repos`

返回当前已扫描的仓库列表。

### `POST /api/repos/{id}/refresh`

刷新指定仓库状态。

### `POST /api/repos/{id}/fetch`

执行：

```bash
git fetch
```

### `POST /api/repos/{id}/pull`

执行：

```bash
git pull
```

### `POST /api/repos/{id}/push`

执行：

```bash
git push
```

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

## 状态

- `clean`：无修改，已同步
- `dirty`：有未提交或未跟踪文件
- `ahead`：本地领先远端
- `behind`：本地落后远端
- `diverged`：本地和远端都有新提交
- `no_remote`：没有 upstream
- `error`：Git 命令执行失败

## 打包

Windows 下执行：

```bash
pyinstaller --onefile --add-data "static;static" app.py
```

生成的 exe 在 `dist/` 目录中。
