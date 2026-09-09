"""Save a local, non-secret source baseline without making a Git commit."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile
from datetime import datetime, timezone

repo = Path(__file__).resolve().parent.parent
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
output = repo.parent / "outputs" / "20260904-pg-migration" / ("baseline-" + stamp)
output.mkdir(parents=True, exist_ok=False)
env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1"}
def git(*args):
    return subprocess.check_output(["git", *args], cwd=repo, env=env)
status = git("status", "--porcelain=v1", "-z").decode("utf-8")
names = set(git("ls-files", "-z").decode("utf-8").split("\0"))
for root in (repo / "scripts", repo / "docs" / "project-management"):
    names.update(p.relative_to(repo).as_posix() for p in root.rglob("*") if p.is_file())
names.update({"PROJECT_DASHBOARD.md", "src/lib/map-data.ts", "requirements-data.txt"})
secret = re.compile(rb"(?:postgres(?:ql)?://[^\s\"']+:[^\s\"']+@|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|(?:PGPASSWORD|password)\s*=\s*['\"][^'\"]+['\"])", re.I)
included, excluded = [], []
archive = output / "source-baseline.zip"
with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
    for name in sorted(names):
        if not name:
            continue
        p = repo / name
        if not p.is_file():
            excluded.append({"path": name, "reason": "absent-in-working-tree"})
            continue
        if name.startswith(("public/data/", "output/")) or "/__pycache__/" in name or p.name.startswith(".env") or p.stat().st_size > 12_000_000:
            excluded.append({"path": name, "reason": "data/cache/environment; original retained"})
            continue
        raw = p.read_bytes()
        if secret.search(raw):
            excluded.append({"path": name, "reason": "potential secret; original retained"})
            continue
        z.writestr(name, raw)
        included.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
report = {"createdAt": stamp, "gitHead": git("rev-parse", "HEAD").decode().strip(), "gitStatus": status.split("\0"), "included": included, "excluded": excluded, "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "gitCommitCreated": False}
(output / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
with zipfile.ZipFile(archive) as z:
    if z.testzip() is not None:
        raise RuntimeError("Baseline ZIP verification failed")
print(json.dumps({"baseline": str(output), "files": len(included), "excluded": len(excluded), "zipVerified": True}, ensure_ascii=False))
