from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import app as fund_app  # noqa: E402
from fund_refresh import refresh_funds_snapshot  # noqa: E402


def refresh_sync_snapshots(sync_code: str | None = None, dry_run: bool = False) -> dict[str, int]:
    with fund_app.DATA_LOCK:
        db = fund_app.load_data()
        refreshed = 0
        skipped = 0

        for code, entry in list(db.items()):
            if sync_code and code != sync_code:
                continue

            funds_data, _, _ = fund_app.unpack_sync_entry(entry)
            if not funds_data:
                skipped += 1
                continue

            snapshot = refresh_funds_snapshot(funds_data)
            refreshed += 1

            if dry_run:
                continue

            db[code] = {
                "data": funds_data,
                "snapshot": snapshot,
                "updated_at": fund_app.utc_now_iso(),
                "auto_refreshed_at": fund_app.utc_now_iso(),
            }

        if not dry_run and refreshed:
            fund_app.save_data(db)

    return {
        "refreshed": refreshed,
        "skipped": skipped,
        "total": len(db),
    }


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
