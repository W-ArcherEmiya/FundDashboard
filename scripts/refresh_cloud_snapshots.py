from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import app as fund_app  # noqa: E402


def refresh_sync_snapshots(sync_code: str | None = None, dry_run: bool = False) -> dict[str, int]:
    return fund_app.refresh_sync_snapshots(sync_code=sync_code, dry_run=dry_run)


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh FundDashboard cloud sync snapshots.")
    parser.add_argument("--sync-code", help="Only refresh one sync code.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and calculate without writing sync_data.json.")
    args = parser.parse_args()

    result = refresh_sync_snapshots(sync_code=args.sync_code, dry_run=args.dry_run)
    print(
        "refresh_cloud_snapshots: "
        f"refreshed={result['refreshed']} skipped={result['skipped']} total={result['total']}"
    )

    if args.sync_code and result["refreshed"] == 0:
        print(f"sync code not refreshed: {args.sync_code}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
