import argparse
import os
import subprocess
import sys
import threading
import time
import webbrowser
from io import BytesIO
from pathlib import Path

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template_string,
    request,
    send_file,
    url_for,
)

from git_service import (
    apply_bulk_file_action,
    apply_file_action,
    checkout_repo,
    commit_repo,
    discard_repo_changes,
    get_repo_status,
    preview_repo_file,
    run_git,
)
from repo_store import RepoStore
from snapshot_service import (
    export_working_tree_snapshot,
    import_working_tree_snapshot,
)

BASE_DIR = Path(__file__).resolve().parent

HOST = "127.0.0.1"
PORT = 8765
DEFAULT_WORKSPACE = ""
NO_BROWSER = False
BASE_PATH = ""


def resource_path(relative_path: str) -> Path:
    base_path = getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)
    return Path(base_path) / relative_path


STATIC_DIR = resource_path("static")
app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    static_url_path="/static",
)
store = RepoStore()


class PrefixMiddleware(object):
    def __init__(self, app, prefix=""):
        self.app = app
        self.prefix = prefix

    def __call__(self, environ, start_response):
        if not self.prefix:
            return self.app(environ, start_response)

        path_info = environ.get("PATH_INFO", "") or "/"
        if path_info == self.prefix:
            start_response(
                "308 Permanent Redirect",
                [("Location", self.prefix + "/")],
            )
            return [b""]

        if path_info.startswith(self.prefix + "/"):
            environ["SCRIPT_NAME"] = self.prefix
            environ["PATH_INFO"] = path_info[len(self.prefix):] or "/"
            return self.app(environ, start_response)

        start_response(
            "404 Not Found",
            [("Content-Type", "text/plain; charset=utf-8")],
        )
        return [b"Not Found"]


def api_error(detail: str, status_code: int):
    response = jsonify({"detail": detail, "success": False})
    response.status_code = status_code
    return response


def send_bytes_download(content: bytes, filename: str, mimetype: str):
    payload = BytesIO(content)
    kwargs = {
        "mimetype": mimetype,
        "as_attachment": True,
    }
    try:
        return send_file(payload, download_name=filename, **kwargs)
    except TypeError:
        payload.seek(0)
        return send_file(payload, attachment_filename=filename, **kwargs)


def read_json_body():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


@app.route("/")
def index():
    template = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return render_template_string(
        template,
        app_base_path=request.script_root or "",
        style_url=url_for("static", filename="style.css"),
        message_js_url=url_for("static", filename="message.js"),
        app_js_url=url_for("static", filename="app.js"),
    )


@app.route("/api/config")
def config():
    return jsonify(
        {
            "success": True,
            "default_workspace": DEFAULT_WORKSPACE,
            "host": HOST,
            "port": PORT,
            "base_path": request.script_root or BASE_PATH,
        }
    )


@app.route("/api/select-folder", methods=["POST"])
def select_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected_path = filedialog.askdirectory(title="Select workspace folder")
        root.destroy()
        return jsonify({"success": True, "path": selected_path})
    except Exception as exc:
        return api_error(f"Failed to open folder picker: {exc}", 500)


@app.route("/api/scan", methods=["POST"])
def scan():
    payload = read_json_body()
    parent = Path(str(payload.get("path", ""))).expanduser()
    if not parent.exists() or not parent.is_dir():
        return api_error("Path does not exist or is not a directory.", 400)

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

    return jsonify({"success": True, "repos": repos, "non_git_dirs": non_git_dirs})


@app.route("/api/repos")
def repos():
    return jsonify({"success": True, "repos": store.all()})


def require_repo(repo_id: str) -> Path:
    repo_path = store.get_path(repo_id)
    if repo_path is None:
        raise LookupError("Repository id not found.")
    if not repo_path.exists() or not repo_path.is_dir():
        raise LookupError("Repository path no longer exists.")
    return repo_path


def refresh_repo(repo_id: str):
    repo_path = require_repo(repo_id)
    repo = get_repo_status(repo_id, repo_path)
    store.update(repo_id, repo)
    return repo


def with_repo(repo_id: str):
    try:
        return require_repo(repo_id), None
    except LookupError as exc:
        return None, api_error(str(exc), 404)


@app.route("/api/repos/<repo_id>/refresh", methods=["POST"])
def refresh(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    _ = repo_path
    return jsonify({"success": True, "repo": refresh_repo(repo_id)})


def run_repo_command(repo_id: str, args):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    result = run_git(repo_path, args)
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/fetch", methods=["POST"])
def fetch(repo_id: str):
    return run_repo_command(repo_id, ["fetch"])


@app.route("/api/repos/<repo_id>/pull", methods=["POST"])
def pull(repo_id: str):
    return run_repo_command(repo_id, ["pull"])


@app.route("/api/repos/<repo_id>/push", methods=["POST"])
def push(repo_id: str):
    return run_repo_command(repo_id, ["push"])


@app.route("/api/repos/<repo_id>/open", methods=["POST"])
def open_repo(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    try:
        if sys.platform.startswith("win"):
            os.startfile(repo_path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(repo_path)])
        else:
            subprocess.Popen(["xdg-open", str(repo_path)])
    except Exception as exc:
        return api_error(f"Failed to open repository folder: {exc}", 500)
    return jsonify({"success": True})


@app.route("/api/repos/<repo_id>/commit", methods=["POST"])
def commit(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    payload = read_json_body()
    result = commit_repo(repo_path, str(payload.get("message", "")))
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/checkout", methods=["POST"])
def checkout(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    payload = read_json_body()
    result = checkout_repo(repo_path, str(payload.get("branch", "")))
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/discard", methods=["POST"])
def discard(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    result = discard_repo_changes(repo_path)
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/files/preview", methods=["POST"])
def file_preview(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    payload = read_json_body()
    result = preview_repo_file(
        repo_path, str(payload.get("path", "")), str(payload.get("scope", ""))
    )
    return jsonify(result)


@app.route("/api/repos/<repo_id>/files/action", methods=["POST"])
def file_action(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    payload = read_json_body()
    result = apply_file_action(
        repo_path,
        str(payload.get("action", "")),
        str(payload.get("path", "")),
    )
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/files/bulk-action", methods=["POST"])
def bulk_file_action(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    payload = read_json_body()
    repo_status = get_repo_status(repo_id, repo_path)
    result = apply_bulk_file_action(
        repo_path,
        str(payload.get("scope", "")),
        str(payload.get("action", "")),
        repo_status,
    )
    repo = refresh_repo(repo_id)
    return jsonify({"success": result["success"], "result": result, "repo": repo})


@app.route("/api/repos/<repo_id>/export-state", methods=["POST"])
def export_state(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error
    try:
        archive = export_working_tree_snapshot(repo_path)
    except ValueError as exc:
        return api_error(str(exc), 400)

    filename = "{0}-working-tree-snapshot.zip".format(repo_path.name)
    return send_bytes_download(archive, filename, "application/zip")


@app.route("/api/repos/<repo_id>/import-state", methods=["POST"])
def import_state(repo_id: str):
    repo_path, error = with_repo(repo_id)
    if error:
        return error

    snapshot = request.files.get("snapshot")
    if snapshot is None:
        return api_error("Snapshot file is required.", 400)

    try:
        archive = snapshot.read()
        result = import_working_tree_snapshot(repo_path, archive)
    except ValueError as exc:
        return api_error(str(exc), 400)

    repo = refresh_repo(repo_id)
    return jsonify({"success": True, "result": result, "repo": repo})


def open_browser():
    time.sleep(1)
    target = "http://{0}:{1}{2}/".format(HOST, PORT, BASE_PATH)
    webbrowser.open(target)


def normalize_base_path(value: str) -> str:
    cleaned = value.strip()
    if not cleaned or cleaned == "/":
        return ""
    if not cleaned.startswith("/"):
        cleaned = "/" + cleaned
    return cleaned.rstrip("/")


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError("Invalid boolean value: {0}".format(value))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Git Folder Dashboard web server."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host address to bind. Default: 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to bind. Default: 8765",
    )
    parser.add_argument(
        "--default-path",
        "--defaut-path",
        dest="default_path",
        default="",
        help="Default workspace path shown in the UI.",
    )
    parser.add_argument(
        "--base-path",
        dest="base_path",
        default="",
        help="Mount the app under a URL prefix such as /git.",
    )
    parser.add_argument(
        "--no-browser",
        "--no-brower",
        dest="no_browser",
        nargs="?",
        const="true",
        default="false",
        type=parse_bool,
        help="Disable auto-opening the browser. Supports true/false.",
    )
    return parser.parse_args()


def apply_runtime_config(args: argparse.Namespace) -> None:
    global HOST, PORT, DEFAULT_WORKSPACE, NO_BROWSER, BASE_PATH
    HOST = args.host
    PORT = args.port
    DEFAULT_WORKSPACE = args.default_path.strip()
    NO_BROWSER = args.no_browser
    BASE_PATH = normalize_base_path(args.base_path)
    app.wsgi_app = PrefixMiddleware(app.wsgi_app, BASE_PATH)


if __name__ == "__main__":
    apply_runtime_config(parse_args())
    if not NO_BROWSER:
        threading.Thread(target=open_browser, daemon=True).start()
    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)
