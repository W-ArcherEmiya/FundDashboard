import subprocess
import sys
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

COMMANDS = [
    [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
    ["node", "tests/test_dashboard_logic.js"],
]


def main():
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")

    for command in COMMANDS:
        print(f"\n==> Running: {' '.join(command)}", flush=True)
        completed = subprocess.run(command, cwd=ROOT, env=env)
        if completed.returncode != 0:
            return completed.returncode

    print("\nAll test suites passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
