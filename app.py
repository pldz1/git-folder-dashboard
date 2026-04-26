import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from git_service import checkout_repo, commit_repo, get_repo_status, run_git
from repo_store import RepoStore


HOST = "127.0.0.1"
PORT = 8765

app = FastAPI(title="Local Git Manager")
store = RepoStore()


class ScanRequest(BaseModel):
    path: str


class CommitRequest(BaseModel):
    message: str


class CheckoutRequest(BaseModel):
    branch: str


def resource_path(relative_path: str) -> Path:
    base_path = getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)
    return Path(base_path) / relative_path


STATIC_DIR = resource_path("static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/select-folder")
def select_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected_path = filedialog.askdirectory(title="Select workspace folder")
        root.destroy()
        return {"success": True, "path": selected_path}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to open folder picker: {exc}")


@app.post("/api/scan")
def scan(request: ScanRequest):
    parent = Path(request.path).expanduser()
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(status_code=400, detail="Path does not exist or is not a directory.")

    repos = []
    non_git_dirs = []
    store.clear()

    for child in sorted(parent.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir():
            continue

        if (child / ".git").exists():
            repo_id = store.add(child)
            repo = get_repo_status(repo_id, child)
            store.update(repo_id, repo)
            repos.append(repo)
        else:
            non_git_dirs.append({"name": child.name, "path": str(child)})

    return {"success": True, "repos": repos, "non_git_dirs": non_git_dirs}


@app.get("/api/repos")
def repos():
    return {"success": True, "repos": store.all()}


def require_repo(repo_id: str) -> Path:
    repo_path = store.get_path(repo_id)
    if repo_path is None:
        raise HTTPException(status_code=404, detail="Repository id not found.")
    if not repo_path.exists() or not repo_path.is_dir():
        raise HTTPException(status_code=404, detail="Repository path no longer exists.")
    return repo_path


def refresh_repo(repo_id: str):
    repo_path = require_repo(repo_id)
    repo = get_repo_status(repo_id, repo_path)
    store.update(repo_id, repo)
    return repo


@app.post("/api/repos/{repo_id}/refresh")
def refresh(repo_id: str):
    return {"success": True, "repo": refresh_repo(repo_id)}


@app.post("/api/repos/{repo_id}/fetch")
def fetch(repo_id: str):
    repo_path = require_repo(repo_id)
    result = run_git(repo_path, ["fetch"])
    repo = refresh_repo(repo_id)
    return {"success": result["success"], "result": result, "repo": repo}


@app.post("/api/repos/{repo_id}/pull")
def pull(repo_id: str):
    repo_path = require_repo(repo_id)
    result = run_git(repo_path, ["pull"])
    repo = refresh_repo(repo_id)
    return {"success": result["success"], "result": result, "repo": repo}


@app.post("/api/repos/{repo_id}/push")
def push(repo_id: str):
    repo_path = require_repo(repo_id)
    result = run_git(repo_path, ["push"])
    repo = refresh_repo(repo_id)
    return {"success": result["success"], "result": result, "repo": repo}


@app.post("/api/repos/{repo_id}/commit")
def commit(repo_id: str, request: CommitRequest):
    repo_path = require_repo(repo_id)
    result = commit_repo(repo_path, request.message)
    repo = refresh_repo(repo_id)
    return {"success": result["success"], "result": result, "repo": repo}


@app.post("/api/repos/{repo_id}/checkout")
def checkout(repo_id: str, request: CheckoutRequest):
    repo_path = require_repo(repo_id)
    result = checkout_repo(repo_path, request.branch)
    repo = refresh_repo(repo_id)
    return {"success": result["success"], "result": result, "repo": repo}


def open_browser():
    time.sleep(1)
    webbrowser.open(f"http://{HOST}:{PORT}")


if __name__ == "__main__":
    if os.environ.get("LOCAL_GIT_MANAGER_NO_BROWSER") != "1":
        threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT)
