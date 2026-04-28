# Git Folder Dashboard

[English](README.md) | 中文

一个本地运行的 Git 仓库管理面板。

给定一个父目录，自动扫描其一级子目录中的 Git 仓库，并通过 Web 页面统一查看状态、文件改动，并执行常见操作。

定位：多仓库总览工具，而不是 IDE 替代品。

![v1.0.0 preview](https://pldz1.com/api/v1/website/image/live-demo/git-folder-dashboard.gif@raw)

---

## 功能概览

适用于类似结构：

```text
~/Code
  project-a
  project-b
  project-c
  notes
```

提供能力：

- 扫描目录，识别 Git 仓库
- 展示当前分支、同步状态（ahead / behind）
- 展示工作区改动（staged / unstaged / untracked）
- 将当前工作区不一致状态导出为快照 zip
- 导入快照 zip，并强行应用到当前工作区
- 查看文件 diff 或内容
- 执行常见操作：

  - fetch / pull / push
  - commit / checkout

- 文件级操作：

  - 暂存 / 撤回暂存
  - 丢弃改动
  - 删除 / 忽略未跟踪文件

运行兼容性：

- 支持 Python 3.6
- 适合 Ubuntu 18.04 环境
- 依赖版本是刻意锁定的，因为新的 ASGI 栈在这个 Python 3.6 目标环境下不够稳定
- 当前建议的兼容组合是 `Flask 2.0.3` + `Werkzeug 2.0.3`
- 支持通过 `--base-path /git` 挂在子路径下

---

## 架构

整体结构保持简单：

- 后端（Python / Flask）：执行 Git 命令、访问文件系统、返回 JSON
- 前端（原生 HTML / JS）：渲染 UI、管理状态、处理交互
- 内存存储：维护 `repo_id -> path` 映射

数据流：

```text
浏览器
  ↓
static (HTML / JS)
  ↓
Flask (app.py)
  ↓
git_service.py
  ↓
Git + 文件系统
```

---

## 项目结构

```text
git-folder-dashboard/
  app.py
  git_service.py
  snapshot_service.py
  repo_store.py
  static/
    index.html
    style.css
    message.js
    app.js
```

职责划分：

- `app.py`

  - 路由定义
  - 参数校验
  - 调用服务层
  - 返回响应

- `git_service.py`

  - 所有 Git 操作
  - 状态解析
  - 文件操作实现

- `snapshot_service.py`

  - 构建工作区快照
  - 导出不一致状态 zip
  - 导入快照并直接覆盖文件

- `repo_store.py`

  - 内存映射：`repo_id -> path`

- `static/`

  - 前端 UI 与交互逻辑

---

## 后端职责

仅处理三类逻辑：

1. 接收请求
2. 执行 Git / 文件操作
3. 返回 JSON

不包含：

- 模板渲染
- 持久化存储
- 前端状态管理

---

## 核心模块说明

### git_service.py

核心业务逻辑所在。

#### Git 执行入口

```text
run_git(repo_path, args)
```

统一执行所有 Git 命令并返回标准结构结果。

---

#### 仓库状态

```text
get_repo_status(repo_id, repo_path)
```

返回信息包括：

- 当前分支
- 分支列表（本地 / 远端）
- 文件改动（staged / unstaged / untracked）
- 是否 dirty
- ahead / behind
- 仓库状态（clean / dirty / diverged 等）

---

#### 文件操作

统一入口：

```text
apply_file_action()
```

支持：

- stage → `git add`
- unstage → `git restore --staged`
- discard → `git restore`
- delete → 删除文件
- ignore → 写入 `.git/info/exclude`

---

### snapshot_service.py

负责工作区快照导出 / 导入。

原则：

- 不把 `git apply` 作为主要恢复方案
- 导出的是当前工作区最终结果，而不是 patch 流
- 导入时直接按文件覆盖 / 创建 / 删除

快照 zip 内容：

- `manifest.json`
- `files/*`

`manifest.json` 记录：

- 相对路径
- 条目类型（`modified` / `added` / `deleted`）
- 来源范围（`staged` / `unstaged` / `untracked`）
- 需要内容时，对应 zip 内 payload 的位置

当前能力边界：

- 恢复工作区最终文件状态
- 支持修改 / 新增 / 删除文件
- 支持嵌套新增文件
- 支持二进制文件，因为内容直接写入 zip
- 不尝试精确恢复 Git index 的 staged 布局
- 不依赖 patch 上下文匹配

---

### repo_store.py

维护仓库映射关系：

```text
repo_id → 本地路径
```

特点：

- 纯内存存储
- 不持久化
- 服务重启后需重新扫描

---

### app.py

负责请求调度：

```text
请求 → 路由 → service → refresh → 返回
```

关键流程：

- 根据 `repo_id` 获取路径
- 调用对应 Git 操作
- 刷新仓库状态
- 返回最新数据

启动说明：

- 使用 Flask 的同步本地服务，而不是 ASGI 栈
- 避开 `uvicorn`、`h11`、`asyncio` 在 Python 3.6 下的兼容性问题
- 支持通过配置 URL 前缀来适配子路径部署

示例：

```bash
python app.py --host 0.0.0.0 --port 8765 --base-path /git
```

这样应用会挂在：

```text
https://example.com/git/
```

---

## 前端说明

无框架实现，基于单一状态驱动渲染。

核心状态：

```text
state = {
  repos,
  activeRepoId,
  theme,
  preview,
  ...
}
```

职责：

- 渲染仓库列表与详情
- 管理 UI 状态（tab / 展开 / 主题）
- 管理中英文切换
- 调用 API
- 根据返回结果重新渲染

---

### 文件树渲染

后端返回扁平路径列表：

```text
a/b/c.txt
```

前端负责：

1. 拆分路径
2. 构建树结构
3. 渲染节点

优点：

- 后端保持简单
- UI 可自由调整

---

## 典型流程

以“暂存文件”为例：

```text
点击按钮
  ↓
前端请求 /files/action
  ↓
app.py 路由
  ↓
apply_file_action()
  ↓
git add
  ↓
refresh_repo()
  ↓
get_repo_status()
  ↓
返回结果
  ↓
前端重新渲染
```

---

## 配置

程序通过命令行参数传入启动配置，不依赖 `.env`。

---

## 启动

常用命令：

| 场景                          | 命令                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| 默认启动                      | `python app.py`                                                                      |
| 自定义 host / port / 默认路径 | `python app.py --host 127.0.0.1 --port 8080 --default-path ~/Code --no-browser=true` |
| 挂载到子路径                  | `python app.py --host 0.0.0.0 --port 8765 --base-path /git`                          |

参数说明：

| 参数             | 说明                                      | 默认值      |
| ---------------- | ----------------------------------------- | ----------- |
| `--host`         | 监听地址                                  | `127.0.0.1` |
| `--port`         | 监听端口                                  | `8765`      |
| `--default-path` | 默认工作区路径                            | `""`        |
| `--base-path`    | 子路径部署时的 URL 前缀，例如 `/git`      | `""`        |
| `--no-browser`   | 是否禁用自动打开浏览器，支持 `true/false` | `false`     |

兼容别名：

| 别名            | 等价参数         |
| --------------- | ---------------- |
| `--defaut-path` | `--default-path` |
| `--no-brower`   | `--no-browser`   |

默认地址：

```text
http://127.0.0.1:8765
```

---

## 发布

```bash
pip install -r requirements.txt
pyinstaller --onefile --name git-folder-dashboard --add-data "static:static" app.py
```

Windows 用这个：

```bat
pip install -r requirements.txt
pyinstaller --onefile --name git-folder-dashboard --add-data "static;static" app.py
```

打包完成后，可执行文件在：

```bash
dist/git-folder-dashboard
```

例如：

```bash
./dist/git-folder-dashboard --host 127.0.0.1 --port 8080 --default-path ~/Code --base-path /git --no-browser=true
```

---

## API

### 配置

- `GET /api/config`

### 工作区

- `POST /api/select-folder`
- `POST /api/scan`

### 仓库操作

- `POST /api/repos/{id}/refresh`
- `POST /api/repos/{id}/fetch`
- `POST /api/repos/{id}/pull`
- `POST /api/repos/{id}/push`
- `POST /api/repos/{id}/commit`
- `POST /api/repos/{id}/checkout`
- `POST /api/repos/{id}/discard`

### 文件操作

- `POST /api/repos/{id}/files/preview`
- `POST /api/repos/{id}/files/action`
- `POST /api/repos/{id}/files/bulk-action`

---

## 核心调用链

后端的主要调用关系可以简化为：

```text
浏览器请求
  → app.py 路由
    → require_repo()
    → git_service.*()
    → refresh_repo()
      → get_repo_status()
    → 返回 JSON
```

职责划分很明确：

- `app.py`：决定调用哪个动作
- `git_service.py`：负责具体执行
- `get_repo_status()`：负责生成最终展示数据

---

## 扫描流程

```text
POST /api/scan
  → app.py.scan()
    → repo_store.clear()
    → repo_store.add()
    → get_repo_status()
    → repo_store.update()
```

输出：

- 仓库列表
- 非 Git 目录列表

---

## 文件操作链路

```text
POST /files/action
  → app.py.file_action()
    → apply_file_action()
      → stage_file()
      → unstage_file()
      → discard_file()
      → ...
    → refresh_repo()
      → get_repo_status()
```

关键点：

- 所有文件操作统一从 `apply_file_action()` 进入
- 操作完成后强制刷新状态，保证前端一致性

---

## 预览链路

```text
POST /files/preview
  → app.py.file_preview()
    → preview_repo_file()
      → git diff
      → git diff --cached
      → read file
```

根据文件状态决定预览方式：

- staged → `git diff --cached`
- unstaged → `git diff`
- untracked → 直接读取文件

---

## 仓库操作链路

```text
POST /repos/{id}/push
  → app.py.repo_action()
    → run_git(["push"])
    → refresh_repo()
```

其他操作类似：

```text
fetch / pull / checkout / commit
  → 对应 git_service 函数
  → refresh_repo()
```

---

## 前端调用链

```text
scan()
previewFile()
runRepoAction()
runFileAction()
  → requestJson()
    → 调用后端 API
  → 更新 state
  → render()
```

渲染拆分：

```text
render()
  → renderTabs()
  → renderSidebar()
  → renderRepoDetail()
  → renderNonGit()
```

---

## 一个完整操作路径（示例）

```text
点击「暂存文件」
  → runFileAction()
  → POST /files/action
  → apply_file_action()
  → git add
  → refresh_repo()
  → get_repo_status()
  → 返回最新状态
  → render()
```

---

## 关键函数分层

### 调度层（app.py）

```text
require_repo()
refresh_repo()
各类 /api 路由
```

---

### 核心逻辑（git_service.py）

```text
run_git()
get_repo_status()
commit_repo()
checkout_repo()
discard_repo_changes()
```

---

### 文件操作

```text
apply_file_action()
apply_bulk_file_action()

stage_file()
unstage_file()
discard_file()
delete_untracked_file()
ignore_untracked_file()
```

---

### 状态解析

```text
parse_porcelain_line()
normalize_status()
build_file_entry()
```

---

## 一句话总结结构

```text
app.py 负责“调度”
git_service.py 负责“执行”
get_repo_status() 负责“生成视图数据”
前端负责“渲染”
```

---

## 仓库状态说明

- `clean`：无改动
- `dirty`：存在未提交改动
- `ahead`：本地领先远端
- `behind`：落后远端
- `diverged`：分叉
- `no_remote`：无 upstream
- `error`：状态获取失败

---

## 限制

- 仅扫描一级子目录
- 不持久化仓库数据
- commit 为统一提交（`git add .`）
- 无权限控制（本地使用场景）

---

## 阅读顺序建议

- 后端入口：`app.py`
- 核心逻辑：`git_service.py`
- 数据映射：`repo_store.py`
- 前端实现：`static/app.js`

---
