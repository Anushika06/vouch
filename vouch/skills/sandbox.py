"""Skill sandboxes.

1. OpenShell (NVIDIA, Apache-2.0) — when the `openshell` CLI is installed and VOUCH_SANDBOX=openshell.
   We generate an OpenShell policy from the skill manifest (filesystem + per-domain network rules).
   OpenShell's docs do not yet document a non-interactive exec command, so the run command is taken
   from VOUCH_OPENSHELL_EXEC (a template); without it the adapter reports itself unavailable.
2. Fallback (default, used by the hosted demo): a restricted subprocess. Isolated interpreter (-I), empty
   environment, temp working dir, timeout, and a PEP 578 audit hook that blocks network except
   manifest-declared domains, process spawning, ctypes, and file access outside the sandbox. Audit
   hooks are a tripwire, not a security boundary against native code — see docs/threat-model.md.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

from vouch.skills.scanner import Manifest

BOOTSTRAP = r'''
import json, os, runpy, socket, sys
ROOT = os.path.realpath(os.environ["VOUCH_SANDBOX_ROOT"])
ALLOWED = set(json.loads(os.environ.get("VOUCH_ALLOWED_HOSTS", "[]")))
READ_OK = [os.path.realpath(p) for p in {sys.prefix, sys.base_prefix, sys.exec_prefix,
                                         os.path.dirname(os.__file__)}] + [ROOT]
OK_IPS = set()
PERMISSIVE_NET = os.environ.get("VOUCH_PERMISSIVE_NET") == "1"
_real_gai = socket.getaddrinfo

def _seen(kind, detail):
    sys.stderr.write("VOUCH_SEEN " + json.dumps({"kind": kind, "detail": str(detail)[:200]}) + "\n")

def _blocked(kind, detail):
    sys.stderr.write("VOUCH_BLOCKED " + json.dumps({"kind": kind, "detail": str(detail)[:200]}) + "\n")
    sys.stderr.flush()
    raise PermissionError("vouch sandbox: %s blocked (%s)" % (kind, detail))

def _under(p, roots):
    rp = os.path.realpath(p)
    return any(rp == r or rp.startswith(r + os.sep) for r in roots)

def _host_ok(h):
    if PERMISSIVE_NET:
        _seen("network", h)
        return True
    return h in ALLOWED or any(h.endswith("." + a) for a in ALLOWED)

def _gai(host, *a, **k):
    h = host.decode() if isinstance(host, bytes) else str(host)
    res = _real_gai(host, *a, **k)
    if _host_ok(h):
        OK_IPS.update(r[4][0] for r in res)
    return res
socket.getaddrinfo = _gai

def hook(event, args):
    if event == "open":
        path = args[0]
        if isinstance(path, int):
            return
        p = os.fsdecode(path)
        mode = str(args[1]) if len(args) > 1 and args[1] is not None else "r"
        if any(c in mode for c in "wax+"):
            if not _under(p, [ROOT]):
                _blocked("file_write", p)
        elif not _under(p, READ_OK):
            _blocked("file_read", p)
    elif event == "socket.getaddrinfo":
        h = args[0].decode() if isinstance(args[0], bytes) else str(args[0])
        if not _host_ok(h):
            _blocked("network", h)
    elif event == "socket.connect":
        addr = args[1]
        ip = addr[0] if isinstance(addr, tuple) else str(addr)
        if ip not in OK_IPS and not PERMISSIVE_NET:
            _blocked("network", ip)
    elif event in ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.fork",
                   "os.forkpty", "pty.spawn", "os.startfile", "os.kill"):
        _blocked("process", event)
    elif event == "import" and args[0] in ("ctypes", "_ctypes", "cffi"):
        _blocked("import", args[0])
    elif event in ("os.remove", "os.rmdir", "os.rename", "shutil.rmtree") and not _under(os.fsdecode(args[0]), [ROOT]):
        _blocked("file_delete", args[0])

sys.addaudithook(hook)
sys.argv = [os.environ["VOUCH_ENTRY"]]
runpy.run_path(os.environ["VOUCH_ENTRY"], run_name="__main__")
'''


def openshell_policy(man: Manifest, workdir: str = "/sandbox") -> dict:
    """OpenShell policy (version 1 schema) derived from a skill's permission manifest."""
    pol: dict = {
        "version": 1,
        "filesystem_policy": {"read_only": ["/usr", "/lib", "/etc", workdir], "read_write": ["/tmp"]},
        "process": {"run_as_user": "1500", "run_as_group": "1500"},
        "network_policies": {},
    }
    for dom in man.network:
        key = "skill_" + "".join(c if c.isalnum() else "_" for c in dom)
        pol["network_policies"][key] = {
            "endpoints": [{"host": dom, "port": 443, "protocol": "rest", "enforcement": "enforce", "access": "read-only"}],
            "binaries": [{"path": "/usr/bin/python3"}],
        }
    return pol


def openshell_available() -> bool:
    return bool(shutil.which("openshell")) and bool(os.environ.get("VOUCH_OPENSHELL_EXEC"))


def run(skill_dir: Path, man: Manifest, payload: dict, mode: str = "auto", timeout: int = 10,
        allow_network: bool = True) -> dict:
    """mode "none" is the naive baseline: no network policy at all (attempts are only logged). File and
    process guards stay on even then, so demo malware never touches the host running the demo."""
    if mode == "none":
        return _run_subprocess(skill_dir, man, payload, timeout, True, permissive=True)
    if mode == "openshell" or (mode == "auto" and openshell_available()):
        if openshell_available():
            return _run_openshell(skill_dir, man, payload, timeout)
        if mode == "openshell":
            return {"ok": False, "error": "OpenShell requested but `openshell` CLI or VOUCH_OPENSHELL_EXEC is missing",
                    "sandbox": "openshell"}
    return _run_subprocess(skill_dir, man, payload, timeout, allow_network)


def _run_subprocess(skill_dir: Path, man: Manifest, payload: dict, timeout: int, allow_network: bool,
                    permissive: bool = False) -> dict:
    work = Path(tempfile.mkdtemp(prefix="vouch-skill-"))
    try:
        dest = work / "skill"
        shutil.copytree(skill_dir, dest, ignore=shutil.ignore_patterns("__pycache__"))
        boot = work / "vouch_bootstrap.py"
        boot.write_text(BOOTSTRAP, encoding="utf-8")
        env = {"VOUCH_SANDBOX_ROOT": str(work), "VOUCH_ENTRY": str(dest / man.entrypoint),
               "VOUCH_ALLOWED_HOSTS": json.dumps(man.network if allow_network else []),
               "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
               "VOUCH_PERMISSIVE_NET": "1" if permissive else "0"}
        for k in ("SYSTEMROOT", "PATH", "TEMP", "TMP"):  # Windows needs these for the interpreter to start
            if k in os.environ and os.name == "nt":
                env[k] = os.environ[k] if k != "PATH" else os.path.dirname(sys.executable)
        kwargs = {}
        if os.name == "posix":
            import resource

            def limits():
                resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout))
                resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))

            kwargs["preexec_fn"] = limits
        try:
            p = subprocess.run([sys.executable, "-I", str(boot)], input=json.dumps(payload), capture_output=True,
                               text=True, cwd=str(dest), env=env, timeout=timeout, encoding="utf-8", **kwargs)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"timed out after {timeout}s", "sandbox": "subprocess-audit", "blocked": []}
        blocked, seen, log = [], [], []
        for line in (p.stderr or "").splitlines():
            if line.startswith("VOUCH_BLOCKED "):
                blocked.append(json.loads(line[len("VOUCH_BLOCKED "):]))
            elif line.startswith("VOUCH_SEEN "):
                seen.append(json.loads(line[len("VOUCH_SEEN "):]))
            else:
                log.append(line)
        return {"ok": p.returncode == 0, "output": (p.stdout or "")[:20000], "log": "\n".join(log)[-4000:],
                "blocked": blocked, "unblocked_attempts": seen,
                "sandbox": "none (naive)" if permissive else "subprocess-audit", "returncode": p.returncode,
                "error": None if p.returncode == 0 else (log[-1] if log else f"exit {p.returncode}")}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _run_openshell(skill_dir: Path, man: Manifest, payload: dict, timeout: int) -> dict:
    work = Path(tempfile.mkdtemp(prefix="vouch-openshell-"))
    name = f"vouch-{man.name}"[:40]
    try:
        pol = work / "policy.yaml"
        pol.write_text(yaml.safe_dump(openshell_policy(man)), encoding="utf-8")
        (work / "input.json").write_text(json.dumps(payload), encoding="utf-8")
        subprocess.run(["openshell", "sandbox", "create", "--name", name, "--policy", str(pol)], capture_output=True,
                       text=True, timeout=120)
        cmd = os.environ["VOUCH_OPENSHELL_EXEC"].format(name=name, skill_dir=str(skill_dir), entry=man.entrypoint,
                                                        input=str(work / "input.json"))
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout + 60)
        return {"ok": p.returncode == 0, "output": p.stdout[:20000], "log": p.stderr[-4000:], "blocked": [],
                "sandbox": "openshell", "policy": openshell_policy(man)}
    finally:
        subprocess.run(["openshell", "sandbox", "delete", name], capture_output=True, text=True, timeout=60)
        shutil.rmtree(work, ignore_errors=True)
