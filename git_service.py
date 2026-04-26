import subprocess
from pathlib import Path
from typing import List


GIT_TIMEOUT_SECONDS = 30


def run_git(repo_path: Path, args: List[str]) -> dict:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=repo_path,
            shell=False,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
        return {
            "success": completed.returncode == 0,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "returncode": completed.returncode,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "success": False,
            "stdout": exc.stdout or "",
            "stderr": "Git command timed out.",
            "returncode": -1,
        }
    except FileNotFoundError:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Git executable was not found.",
            "returncode": -1,
        }
    except Exception as exc:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(exc),
            "returncode": -1,
        }


def get_repo_status(repo_id: str, repo_path: Path) -> dict:
    base = {
        "id": repo_id,
        "name": repo_path.name,
        "path": str(repo_path),
        "branch": "",
        "local_branches": [],
        "remote_branches": [],
        "dirty": False,
        "untracked": False,
        "has_remote": False,
        "ahead": 0,
        "behind": 0,
        "status": "error",
        "message": "",
    }

    status_result = run_git(repo_path, ["status", "--porcelain"])
    if not status_result["success"]:
        base["message"] = status_result["stderr"] or status_result["stdout"] or "Failed to read git status."
        return base

    branch_result = run_git(repo_path, ["branch", "--show-current"])
    if branch_result["success"]:
        base["branch"] = branch_result["stdout"].strip() or "(detached)"
    else:
        base["branch"] = "(unknown)"

    local_branches_result = run_git(
        repo_path,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    if local_branches_result["success"]:
        base["local_branches"] = [
            branch.strip()
            for branch in local_branches_result["stdout"].splitlines()
            if branch.strip()
        ]

    remote_branches_result = run_git(
        repo_path,
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )
    if remote_branches_result["success"]:
        base["remote_branches"] = [
            branch.strip()
            for branch in remote_branches_result["stdout"].splitlines()
            if branch.strip() and "/" in branch.strip() and not branch.strip().endswith("/HEAD")
        ]

    lines = [line for line in status_result["stdout"].splitlines() if line]
    base["dirty"] = len(lines) > 0
    base["untracked"] = any(line.startswith("??") for line in lines)

    upstream_result = run_git(
        repo_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    if not upstream_result["success"]:
        base["status"] = "no_remote"
        base["message"] = "No upstream remote configured."
        return base

    base["has_remote"] = True
    count_result = run_git(repo_path, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])
    if not count_result["success"]:
        base["status"] = "error"
        base["message"] = count_result["stderr"] or count_result["stdout"] or "Failed to compare with upstream."
        return base

    parts = count_result["stdout"].strip().split()
    if len(parts) == 2:
        base["ahead"] = int(parts[0])
        base["behind"] = int(parts[1])

    if base["dirty"]:
        base["status"] = "dirty"
        base["message"] = "Repository has local changes."
    elif base["ahead"] > 0 and base["behind"] > 0:
        base["status"] = "diverged"
        base["message"] = "Local and remote branches have diverged."
    elif base["ahead"] > 0:
        base["status"] = "ahead"
        base["message"] = "Local branch is ahead of upstream."
    elif base["behind"] > 0:
        base["status"] = "behind"
        base["message"] = "Local branch is behind upstream."
    else:
        base["status"] = "clean"
        base["message"] = "Clean and up to date."

    return base


def commit_repo(repo_path: Path, message: str) -> dict:
    message = message.strip()
    if not message:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Commit message is required.",
            "returncode": 1,
        }

    status_result = run_git(repo_path, ["status", "--porcelain"])
    if not status_result["success"]:
        return status_result
    if not status_result["stdout"].strip():
        return {
            "success": False,
            "stdout": "",
            "stderr": "There are no changes to commit.",
            "returncode": 1,
        }

    add_result = run_git(repo_path, ["add", "."])
    if not add_result["success"]:
        return add_result

    return run_git(repo_path, ["commit", "-m", message])


def checkout_repo(repo_path: Path, branch: str) -> dict:
    branch = branch.strip()
    if not branch:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Branch name is required.",
            "returncode": 1,
        }

    local_branches_result = run_git(
        repo_path,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    local_branches = {
        item.strip()
        for item in local_branches_result["stdout"].splitlines()
        if item.strip()
    } if local_branches_result["success"] else set()

    if branch in local_branches:
        return run_git(repo_path, ["checkout", branch])

    remote_branches_result = run_git(
        repo_path,
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )
    remote_branches = {
        item.strip()
        for item in remote_branches_result["stdout"].splitlines()
        if item.strip() and "/" in item.strip() and not item.strip().endswith("/HEAD")
    } if remote_branches_result["success"] else set()

    if branch in remote_branches:
        local_name = branch.split("/", 1)[1]
        if local_name in local_branches:
            return run_git(repo_path, ["checkout", local_name])
        return run_git(repo_path, ["checkout", "--track", branch])

    return run_git(repo_path, ["checkout", branch])
