from __future__ import annotations

import json
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


REQUEST_TIMEOUT_SECONDS = 8
MAX_REFRESH_WORKERS = 6
MAX_NAV_WORKERS = 6
USER_AGENT = "Mozilla/5.0 FundDashboard/1.0"
EASTMONEY_HISTORY_URL = "https://fund.eastmoney.com/pingzhongdata/{code}.js?rt={timestamp}"
EASTMONEY_LATEST_NAV_URL = (
    "https://api.fund.eastmoney.com/f10/lsjz"
    "?fundCode={code}&pageIndex=1&pageSize=1"
)
FUNDGZ_URL = "https://fundgz.1234567.com.cn/js/{code}.js?rt={timestamp}"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_text(url: str, timeout: int = REQUEST_TIMEOUT_SECONDS, headers: dict[str, str] | None = None) -> str:
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def parse_js_string(source: str, name: str) -> str:
    match = re.search(rf"var\s+{re.escape(name)}\s*=\s*(['\"])(.*?)\1\s*;", source, re.S)
    return match.group(2).strip() if match else ""


def parse_js_bool(source: str, name: str) -> bool:
    match = re.search(rf"var\s+{re.escape(name)}\s*=\s*(true|false)\s*;", source)
    return bool(match and match.group(1) == "true")


def parse_js_json_value(source: str, name: str) -> Any:
    match = re.search(rf"var\s+{re.escape(name)}\s*=\s*(.*?);(?:/\*|$)", source, re.S)
    if not match:
        return None

    raw = match.group(1).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def parse_jsonp_payload(source: str) -> dict[str, Any] | None:
    match = re.search(r"jsonpgz\((.*)\)\s*;?\s*$", source.strip(), re.S)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def date_ms_to_bj_date_str(date_ms: int | float | None) -> str:
    if not date_ms:
        return ""
    try:
        value = float(date_ms)
    except (TypeError, ValueError):
        return ""
    dt = datetime.fromtimestamp(value / 1000, tz=timezone.utc) + timedelta(hours=8)
    return dt.strftime("%Y-%m-%d")


def bj_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc) + timedelta(hours=8)


def is_same_day_settlement_eligible(actual_date: str, now: datetime | None = None) -> bool:
    current_bj = bj_now(now)
    today = current_bj.strftime("%Y-%m-%d")
    return actual_date != today or current_bj.hour >= 23


def date_ms_to_badge(date_ms: int | float | None) -> str:
    date_str = date_ms_to_bj_date_str(date_ms)
    if not date_str:
        return "--"
    return date_str[5:]


def fetch_realtime_estimate(code: str) -> dict[str, Any] | None:
    url = FUNDGZ_URL.format(code=code, timestamp=int(datetime.now().timestamp() * 1000))
    try:
        payload = parse_jsonp_payload(fetch_text(url))
    except (OSError, URLError, TimeoutError):
        return None
    if not payload or str(payload.get("fundcode", "")).strip() != code:
        return None
    return payload


def fetch_history(code: str) -> dict[str, Any] | None:
    url = EASTMONEY_HISTORY_URL.format(code=code, timestamp=int(datetime.now().timestamp() * 1000))
    try:
        source = fetch_text(url)
    except (OSError, URLError, TimeoutError):
        return None

    name = parse_js_string(source, "fS_name")
    is_money_fund = parse_js_bool(source, "ishb")
    money_income = parse_js_json_value(source, "Data_millionCopiesIncome")
    if name and (is_money_fund or (isinstance(money_income, list) and money_income)):
        latest = money_income[-1] if isinstance(money_income, list) and money_income else [int(datetime.now().timestamp() * 1000), 0]
        previous = money_income[-2] if isinstance(money_income, list) and len(money_income) > 1 else latest
        return {
            "name": name,
            "latest": 1.0,
            "prev": 1.0,
            "dateMs": latest[0],
            "isMoneyFund": True,
            "millionIncome": to_float(latest[1]),
            "prevMillionIncome": to_float(previous[1]),
        }

    trend = parse_js_json_value(source, "Data_netWorthTrend")
    if name and isinstance(trend, list) and trend:
        latest = trend[-1]
        previous = trend[-2] if len(trend) > 1 else latest
        return {
            "name": name,
            "latest": to_float(latest.get("y") if isinstance(latest, dict) else None),
            "prev": to_float(previous.get("y") if isinstance(previous, dict) else None),
            "dateMs": latest.get("x") if isinstance(latest, dict) else None,
        }

    return None


def fetch_latest_nav(code: str) -> float | None:
    """Fetch only the latest NAV record instead of the full history script."""
    url = EASTMONEY_LATEST_NAV_URL.format(code=code)
    try:
        source = fetch_text(url, headers={"Referer": "https://fundf10.eastmoney.com/"})
        payload = json.loads(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        return None

    records = ((payload.get("Data") or {}).get("LSJZList") or []) if isinstance(payload, dict) else []
    if not records or not isinstance(records[0], dict):
        return None
    nav = to_float(records[0].get("DWJZ"))
    return nav if nav > 0 else None


def build_snapshot_item(
    fund: dict[str, Any],
    hist: dict[str, Any] | None,
    rt: dict[str, Any] | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    code = str(fund.get("code", "")).strip()
    group = str(fund.get("group") or "默认分组")
    shares = to_float(fund.get("shares"))
    cost = to_float(fund.get("cost"))

    if hist and hist.get("isMoneyFund"):
        name = str((rt or {}).get("name") or hist.get("name") or f"基金 {code}")
        million_income = to_float(hist.get("millionIncome"))
        date_badge = date_ms_to_badge(hist.get("dateMs"))
        return {
            "code": code,
            "group": group,
            "name": name,
            "estRate": 0,
            "estNav": 1,
            "dailyProfit": million_income * shares / 10000,
            "holdProfit": (1 - cost) * shares if cost > 0 else 0,
            "totalAsset": shares,
            "gztime": f"货币收益({date_badge})",
            "isActual": True,
            "isBackup": not bool(rt),
            "isUnavailable": False,
            "valid": True,
        }

    if hist:
        name = str((rt or {}).get("name") or hist.get("name") or f"基金 {code}")
        actual_date = date_ms_to_bj_date_str(hist.get("dateMs"))
        settlement_eligible = is_same_day_settlement_eligible(actual_date, now)
        gztime = str(rt.get("gztime") or "") if rt else ""
        gz_date = gztime.split(" ")[0] if gztime else ""

        if rt and (gz_date > actual_date or not settlement_eligible):
            current_nav = to_float(rt.get("gsz"))
            previous_nav = to_float(hist.get("latest") if settlement_eligible else hist.get("prev"))
            rate = to_float(rt.get("gszzl"))
            time_str = gztime
            is_actual = False
        elif not settlement_eligible:
            current_nav = to_float(hist.get("prev"))
            previous_nav = current_nav
            rate = 0
            time_str = "等待正式净值"
            is_actual = False
        else:
            current_nav = to_float(hist.get("latest"))
            previous_nav = to_float(hist.get("prev"))
            rate = ((current_nav - previous_nav) / previous_nav * 100) if previous_nav > 0 else 0
            time_str = f"实际净值({date_ms_to_badge(hist.get('dateMs'))})"
            is_actual = True

        hold_nav = current_nav if is_actual else to_float(hist.get("latest") if settlement_eligible else hist.get("prev"))
        return {
            "code": code,
            "group": group,
            "name": name,
            "estRate": rate,
            "estNav": current_nav,
            "dailyProfit": (current_nav - previous_nav) * shares,
            "holdProfit": (hold_nav - cost) * shares if cost > 0 else 0,
            "totalAsset": current_nav * shares,
            "gztime": time_str,
            "isActual": is_actual,
            "isBackup": not bool(rt),
            "isUnavailable": False,
            "valid": True,
        }

    if rt:
        current_nav = to_float(rt.get("gsz"))
        previous_nav = to_float(rt.get("dwjz"))
        return {
            "code": code,
            "group": group,
            "name": str(rt.get("name") or f"基金 {code}"),
            "estRate": to_float(rt.get("gszzl")),
            "estNav": current_nav,
            "dailyProfit": (current_nav - previous_nav) * shares,
            "holdProfit": (previous_nav - cost) * shares if cost > 0 else 0,
            "totalAsset": current_nav * shares,
            "gztime": str(rt.get("gztime") or ""),
            "isActual": False,
            "isBackup": False,
            "isUnavailable": False,
            "valid": True,
        }

    return {
        "code": code,
        "group": group,
        "name": f"基金 {code}",
        "gztime": "暂无盘中估算",
        "valid": True,
        "isUnavailable": True,
        "isActual": True,
        "isBackup": True,
    }


def refresh_funds_snapshot(funds: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    def refresh_one(index: int, fund: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        code = str(fund.get("code", "")).strip()
        if not re.fullmatch(r"\d{6}", code):
            return index, None

        hist = fetch_history(code)
        rt = fetch_realtime_estimate(code)
        return index, build_snapshot_item(fund, hist, rt)

    snapshot: list[dict[str, Any] | None] = [None] * len(funds)
    if not funds:
        return snapshot

    workers = max(1, min(MAX_REFRESH_WORKERS, len(funds)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(refresh_one, index, fund)
            for index, fund in enumerate(funds)
        ]
        for future in as_completed(futures):
            index, item = future.result()
            snapshot[index] = item

    return snapshot


def fetch_latest_navs(codes: list[str]) -> dict[str, float]:
    """Fetch latest usable NAV values concurrently for screenshot imports."""
    unique_codes = list(dict.fromkeys(
        str(code).strip() for code in codes
        if re.fullmatch(r"\d{6}", str(code).strip())
    ))
    if not unique_codes:
        return {}

    def fetch_one(code: str) -> tuple[str, float | None]:
        nav = fetch_latest_nav(code)
        if nav is not None:
            return code, nav

        realtime = fetch_realtime_estimate(code)
        nav = to_float((realtime or {}).get("dwjz") or (realtime or {}).get("gsz"))
        return code, nav if nav > 0 else None

    navs: dict[str, float] = {}
    workers = max(1, min(MAX_NAV_WORKERS, len(unique_codes)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(fetch_one, code) for code in unique_codes]
        for future in as_completed(futures):
            code, nav = future.result()
            if nav is not None:
                navs[code] = nav

    return navs
