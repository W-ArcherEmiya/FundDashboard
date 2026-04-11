import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

COMMANDS = [
    [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
    ["node", "tests/test_dashboard_logic.js"],
]


def main():
    for command in COMMANDS:
        print(f"\n==> Running: {' '.join(command)}", flush=True)
        completed = subprocess.run(command, cwd=ROOT)
        if completed.returncode != 0:
            return completed.returncode

    print("\nAll test suites passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
