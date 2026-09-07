from __future__ import annotations

import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


REQUEST_TIMEOUT_SECONDS = 8
MAX_REFRESH_WORKERS = 12
MAX_NAV_WORKERS = 6
USER_AGENT = "Mozilla/5.0 FundDashboard/1.0"
EASTMONEY_HISTORY_URL = "https://fund.eastmoney.com/pingzhongdata/{code}.js?rt={timestamp}"
EASTMONEY_LATEST_NAV_URL = (
    "https://api.fund.eastmoney.com/f10/lsjz"
    "?fundCode={code}&pageIndex=1&pageSize={page_size}"
)
EASTMONEY_VALUATION_URL = (
    "https://fundcomapi.tiantianfunds.com/mm/fundTrade/FundValuationDetail"
    "?FCODE={code}&_={timestamp}"
)
EASTMONEY_INDEX_ESTIMATE_PAGE_URL = "https://fund.eastmoney.com/lof_fundguzhi{page}.html"
INDEX_ESTIMATE_CACHE_SECONDS = 90
LATEST_NAV_CACHE_SECONDS = 30 * 60
INDEX_ESTIMATE_CATEGORY_PAGES = tuple(range(1, 10))

_index_estimate_cache: dict[str, Any] = {
    "date": "",
    "expiresAt": 0.0,
    "items": {},
}

_latest_nav_cache: dict[str, tuple[float, float]] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_text(
    url: str,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
    headers: dict[str, str] | None = None,
    encoding: str = "utf-8-sig",
) -> str:
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode(encoding, errors="replace")


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


def parse_finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


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


def date_str_to_ms(value: Any) -> int | None:
    try:
        dt = datetime.strptime(str(value or "").strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return int(dt.timestamp() * 1000)


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


def parse_realtime_estimate_payload(
    source: str,
    code: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    try:
        outer = json.loads(source)
        inner_raw = outer.get("data") if isinstance(outer, dict) else None
        inner = json.loads(inner_raw) if isinstance(inner_raw, str) else inner_raw
    except json.JSONDecodeError:
        return None

    expansion = inner.get("Expansion") if isinstance(inner, dict) else None
    if not isinstance(expansion, dict) or str(expansion.get("FCODE", "")).strip() != code:
        return None

    gztime = str(expansion.get("GZTIME") or "").strip()
    estimate_date = gztime.split(" ")[0] if gztime else ""
    if estimate_date != bj_now(now).strftime("%Y-%m-%d"):
        return None

    estimated_nav = parse_finite_float(expansion.get("GZ"))
    previous_nav = parse_finite_float(expansion.get("DWJZ"))
    estimated_rate = parse_finite_float(expansion.get("GSZZL"))
    if estimated_nav is None or estimated_nav <= 0 or previous_nav is None or previous_nav <= 0:
        return None
    if estimated_rate is None:
        return None

    return {
        "fundcode": code,
        "name": str(expansion.get("SHORTNAME") or "").strip(),
        "gsz": estimated_nav,
        "dwjz": previous_nav,
        "gszzl": estimated_rate,
        "gztime": gztime,
        "estimateSource": "天天基金盘中估值",
    }


def fetch_realtime_estimate(code: str) -> dict[str, Any] | None:
    url = EASTMONEY_VALUATION_URL.format(
        code=code,
        timestamp=int(datetime.now().timestamp() * 1000),
    )
    try:
        source = fetch_text(url, headers={"Referer": "https://fund.eastmoney.com/"})
    except (OSError, URLError, TimeoutError):
        return None
    return parse_realtime_estimate_payload(source, code)


class _IndexEstimatePageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.calculation_date = ""
        self.value_date = ""
        self.items: dict[str, dict[str, Any]] = {}
        self._date_capture = ""
        self._date_capture_depth = 0
        self._date_text: list[str] = []
        self._table_depth = 0
        self._row: list[dict[str, Any]] | None = None
        self._cell: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        element_id = attributes.get("id") or ""

        if self._date_capture:
            self._date_capture_depth += 1
        elif element_id in {"gsdata", "dwjzdata"}:
            self._date_capture = element_id
            self._date_capture_depth = 1
            self._date_text = []

        if self._table_depth:
            self._table_depth += 1
            if tag == "tr":
                self._row = []
            elif tag == "td" and self._row is not None:
                self._cell = {"attrs": attributes, "text": []}
        elif element_id == "tableContent":
            self._table_depth = 1

    def handle_data(self, data: str) -> None:
        if self._date_capture:
            self._date_text.append(data)
        if self._cell is not None:
            self._cell["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._cell is not None and tag == "td":
            self._cell["text"] = "".join(self._cell["text"]).strip()
            if self._row is not None:
                self._row.append(self._cell)
            self._cell = None
        elif self._row is not None and tag == "tr":
            self._store_row(self._row)
            self._row = None

        if self._table_depth:
            self._table_depth -= 1

        if self._date_capture:
            self._date_capture_depth -= 1
            if self._date_capture_depth == 0:
                match = re.search(r"\d{4}-\d{2}-\d{2}", "".join(self._date_text))
                value = match.group(0) if match else ""
                if self._date_capture == "gsdata":
                    self.calculation_date = value
                else:
                    self.value_date = value
                self._date_capture = ""
                self._date_text = []

    def _store_row(self, cells: list[dict[str, Any]]) -> None:
        if len(cells) < 10:
            return
        code = str(cells[2]["text"]).strip()
        if not re.fullmatch(r"\d{6}", code):
            return

        estimated_nav = parse_finite_float(cells[4]["attrs"].get("data-gz") or cells[4]["text"])
        rate_text = str(cells[5]["attrs"].get("data-gz") or cells[5]["text"]).strip().rstrip("%")
        estimated_rate = parse_finite_float(rate_text)
        previous_nav = parse_finite_float(cells[9]["text"])
        if estimated_nav is None or estimated_nav <= 0 or estimated_rate is None:
            return

        name = str(cells[3]["text"]).strip().split("估算图", 1)[0].strip()
        self.items[code] = {
            "fundcode": code,
            "name": name,
            "gsz": estimated_nav,
            "dwjz": previous_nav or 0,
            "gszzl": estimated_rate,
            "gztime": f"{self.calculation_date} 参考估值",
            "estimateSource": "天天基金指数参考估值",
        }


def parse_index_estimate_page(
    source: str,
    expected_date: str | None = None,
) -> tuple[dict[str, dict[str, Any]], int]:
    parser = _IndexEstimatePageParser()
    parser.feed(source)
    if expected_date and parser.calculation_date != expected_date:
        return {}, 0

    page_numbers = [
        int(value)
        for value in re.findall(r"lof_fundguzhi(\d+)\.html", source)
        if int(value) in INDEX_ESTIMATE_CATEGORY_PAGES
    ]
    page_count = max(page_numbers, default=1)
    return parser.items, page_count


def fetch_index_estimates(now: datetime | None = None) -> dict[str, dict[str, Any]]:
    today = bj_now(now).strftime("%Y-%m-%d")
    if (
        _index_estimate_cache["date"] == today
        and time.monotonic() < float(_index_estimate_cache["expiresAt"])
    ):
        return dict(_index_estimate_cache["items"])

    headers = {"Referer": "https://fund.eastmoney.com/fundguzhi.html"}

    def fetch_page(page: int) -> tuple[dict[str, dict[str, Any]], int]:
        source = fetch_text(
            EASTMONEY_INDEX_ESTIMATE_PAGE_URL.format(page=page),
            headers=headers,
            encoding="gb18030",
        )
        return parse_index_estimate_page(source, today)

    estimates: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=len(INDEX_ESTIMATE_CATEGORY_PAGES)) as executor:
        futures = [executor.submit(fetch_page, page) for page in INDEX_ESTIMATE_CATEGORY_PAGES]
        for future in as_completed(futures):
            try:
                page_items, _ = future.result()
            except (OSError, URLError, TimeoutError):
                continue
            estimates.update(page_items)

    if not estimates:
        return {}

    _index_estimate_cache.update({
        "date": today,
        "expiresAt": time.monotonic() + INDEX_ESTIMATE_CACHE_SECONDS,
        "items": estimates,
    })
    return dict(estimates)


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


def fetch_recent_history(code: str) -> dict[str, Any] | None:
    """Fetch the two latest NAV records from the lightweight JSON endpoint."""
    url = EASTMONEY_LATEST_NAV_URL.format(code=code, page_size=2)
    try:
        source = fetch_text(url, headers={"Referer": "https://fundf10.eastmoney.com/"})
        payload = json.loads(source)
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        return None

    data = payload.get("Data") or {} if isinstance(payload, dict) else {}
    records = data.get("LSJZList") or [] if isinstance(data, dict) else []
    records = [item for item in records if isinstance(item, dict)]
    if not records:
        return None

    latest = records[0]
    previous = records[1] if len(records) > 1 else latest
    latest_value = to_float(latest.get("DWJZ"))
    previous_value = to_float(previous.get("DWJZ"), latest_value)
    if latest_value <= 0:
        return None

    is_money_fund = data.get("FundType") == "005" or data.get("SYType") == "每万份收益"
    return {
        "latest": 1.0 if is_money_fund else latest_value,
        "prev": 1.0 if is_money_fund else previous_value,
        "dateMs": date_str_to_ms(latest.get("FSRQ")),
        "isMoneyFund": is_money_fund,
        "millionIncome": latest_value if is_money_fund else 0,
        "prevMillionIncome": previous_value if is_money_fund else 0,
        "fundType": str(data.get("FundType") or "").strip(),
        "features": [
            item.strip()
            for item in str(data.get("Feature") or "").split(",")
            if item.strip()
        ],
    }


def supports_realtime_estimate(history: dict[str, Any] | None) -> bool:
    if not history:
        return True
    if history.get("isMoneyFund"):
        return False

    fund_type = str(history.get("fundType") or "")
    features = {str(item) for item in (history.get("features") or [])}
    if not fund_type and not features:
        return True
    index_features = {"050", "051", "052", "053", "054", "055"}
    return fund_type in {"001", "006", "007"} or bool(features & index_features)


def fetch_latest_nav(code: str) -> float | None:
    """Fetch the latest NAV with an independent history-source fallback."""
    cached = _latest_nav_cache.get(code)
    if cached and time.monotonic() < cached[1]:
        return cached[0]

    history = fetch_recent_history(code)
    if not history:
        history = fetch_history(code)
    if not history:
        return None
    if history.get("isMoneyFund"):
        nav = 1.0
    else:
        nav = to_float(history.get("latest"))
    if nav <= 0:
        return None

    _latest_nav_cache[code] = (nav, time.monotonic() + LATEST_NAV_CACHE_SECONDS)
    return nav


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
        name = str((rt or {}).get("name") or hist.get("name") or fund.get("name") or f"基金 {code}")
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
            "actualNav": 1,
            "actualNavTime": date_badge,
            "isActual": True,
            "isBackup": not bool(rt),
            "isUnavailable": False,
            "valid": True,
        }

    if hist:
        name = str((rt or {}).get("name") or hist.get("name") or fund.get("name") or f"基金 {code}")
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
        result = {
            "code": code,
            "group": group,
            "name": name,
            "estRate": rate,
            "estNav": current_nav,
            "dailyProfit": (current_nav - previous_nav) * shares,
            "holdProfit": (hold_nav - cost) * shares if cost > 0 else 0,
            "totalAsset": current_nav * shares,
            "gztime": time_str,
            "actualNav": to_float(hist.get("latest")),
            "actualNavTime": actual_date,
            "isActual": is_actual,
            "isBackup": not bool(rt),
            "estimateSource": str((rt or {}).get("estimateSource") or "") if not is_actual else "",
            "isUnavailable": False,
            "valid": True,
        }
        if rt:
            result.update({
                "estimateNav": to_float(rt.get("gsz")),
                "estimateRate": to_float(rt.get("gszzl")),
                "estimateTime": str(rt.get("gztime") or ""),
            })
        return result

    if rt:
        current_nav = to_float(rt.get("gsz"))
        previous_nav = to_float(rt.get("dwjz"))
        return {
            "code": code,
            "group": group,
            "name": str(rt.get("name") or fund.get("name") or f"基金 {code}"),
            "estRate": to_float(rt.get("gszzl")),
            "estNav": current_nav,
            "dailyProfit": (current_nav - previous_nav) * shares,
            "holdProfit": (previous_nav - cost) * shares if cost > 0 else 0,
            "totalAsset": current_nav * shares,
            "gztime": str(rt.get("gztime") or ""),
            "actualNav": previous_nav,
            "actualNavTime": "最新披露",
            "estimateNav": current_nav,
            "estimateRate": to_float(rt.get("gszzl")),
            "estimateTime": str(rt.get("gztime") or ""),
            "isActual": False,
            "isBackup": False,
            "estimateSource": str(rt.get("estimateSource") or ""),
            "isUnavailable": False,
            "valid": True,
        }

    return {
        "code": code,
        "group": group,
        "name": str(fund.get("name") or f"基金 {code}"),
        "gztime": "暂无盘中估算",
        "valid": True,
        "isUnavailable": True,
        "isActual": True,
        "isBackup": True,
    }


def refresh_funds_snapshot(funds: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    def refresh_one(
        index: int,
        fund: dict[str, Any],
    ) -> tuple[int, dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
        code = str(fund.get("code", "")).strip()
        if not re.fullmatch(r"\d{6}", code):
            return index, fund, None, None

        hist = fetch_recent_history(code) or fetch_history(code)
        rt = fetch_realtime_estimate(code) if supports_realtime_estimate(hist) else None
        return index, fund, hist, rt

    snapshot: list[dict[str, Any] | None] = [None] * len(funds)
    if not funds:
        return snapshot

    workers = max(1, min(MAX_REFRESH_WORKERS, len(funds)))
    refreshed: list[tuple[int, dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]] = []
    with ThreadPoolExecutor(max_workers=workers + 1) as executor:
        index_estimates_future = executor.submit(fetch_index_estimates)
        futures = [
            executor.submit(refresh_one, index, fund)
            for index, fund in enumerate(funds)
        ]
        for future in as_completed(futures):
            refreshed.append(future.result())
        index_estimates = index_estimates_future.result()

    for index, fund, hist, realtime in refreshed:
        code = str(fund.get("code", "")).strip()
        estimate = realtime or index_estimates.get(code)
        snapshot[index] = build_snapshot_item(fund, hist, estimate)

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
            try:
                code, nav = future.result()
            except Exception:
                continue
            if nav is not None:
                navs[code] = nav

    return navs
