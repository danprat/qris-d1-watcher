#!/usr/bin/env python3
"""
Fetch Mandiri QRIS transaction data by replaying the authenticated portal request.

Usage workflow:
1. Log in via a browser, open DevTools > Network, and copy the latest `Cookie`,
   `secret-id`, `secret-key`, `secret-token`, and `session-item` header values.
2. Store them in a `.env` file (or export env vars / pass flags) before running.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Optional

try:
    import requests
except ImportError as exc:  # pragma: no cover - requests might not be installed
    raise SystemExit(
        "This script requires the 'requests' package. Install it with "
        "`pip install requests` and retry."
    ) from exc


BASE_URL = (
    "https://qris.bankmandiri.co.id/api/homeScreen/getDataTransaksi/auth/homeScreen"
)
REFRESH_URL = "https://qris.bankmandiri.co.id/api/loginCtl/refresh"

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch QRIS transaction data for the given date range."
    )
    parser.add_argument(
        "--start-date",
        required=True,
        help="Start date in YYYY-MM-DD or YYYYMMDD format.",
    )
    parser.add_argument(
        "--end-date",
        required=True,
        help="End date in YYYY-MM-DD or YYYYMMDD format.",
    )
    parser.add_argument(
        "--cookie",
        default=os.getenv("MANDIRI_COOKIE"),
        help="Exact Cookie header string (or set MANDIRI_COOKIE).",
    )
    parser.add_argument(
        "--secret-id",
        default=os.getenv("MANDIRI_SECRET_ID"),
        help="Value of the secret-id header (or set MANDIRI_SECRET_ID).",
    )
    parser.add_argument(
        "--secret-key",
        default=os.getenv("MANDIRI_SECRET_KEY"),
        help="Value of the secret-key header (or set MANDIRI_SECRET_KEY).",
    )
    parser.add_argument(
        "--secret-token",
        default=os.getenv("MANDIRI_SECRET_TOKEN"),
        help="Value of the secret-token header (or set MANDIRI_SECRET_TOKEN).",
    )
    parser.add_argument(
        "--session-item",
        default=os.getenv("MANDIRI_SESSION_ITEM"),
        help="Value of the session-item header (or set MANDIRI_SESSION_ITEM).",
    )
    parser.add_argument(
        "--user-agent",
        default=os.getenv("MANDIRI_USER_AGENT", DEFAULT_USER_AGENT),
        help="User-Agent header to use. Defaults to the portal's mobile UA.",
    )
    parser.add_argument(
        "--output",
        help="Optional path to write the JSON response.",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to a .env file containing the required headers (default: .env).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Call the portal refresh endpoint before fetching transactions.",
    )
    return parser.parse_args(argv)


def normalize_date(raw: str) -> date:
    """Return a date object from either YYYYMMDD or YYYY-MM-DD input."""
    cleaned = raw.replace("-", "")
    if len(cleaned) != 8 or not cleaned.isdigit():
        raise ValueError(f"Invalid date format: {raw!r}")
    return datetime.strptime(cleaned, "%Y%m%d").date()


def build_headers(args: argparse.Namespace) -> Dict[str, str]:
    required_fields = {
        "secret-id": args.secret_id,
        "secret-key": args.secret_key,
        "secret-token": args.secret_token,
    }
    missing = [name for name, value in required_fields.items() if not value]
    if missing:
        missing_display = ", ".join(missing)
        raise SystemExit(
            f"Missing required header values: {missing_display}. "
            "Provide them via command-line flags or environment variables."
        )

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Connection": "keep-alive",
        "Origin": "https://qris.bankmandiri.co.id",
        "Referer": "https://qris.bankmandiri.co.id/riwayatTransaksi",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": args.user_agent,
        "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
    }
    headers.update(required_fields)
    if args.session_item:
        headers["session-item"] = args.session_item
    return headers


def parse_cookie_string(cookie_str: str) -> Dict[str, str]:
    """Convert a raw Cookie header string into a cookie-name dictionary."""
    cookies: Dict[str, str] = {}
    for part in cookie_str.split(";"):
        name_value = part.strip()
        if not name_value or "=" not in name_value:
            continue
        name, value = name_value.split("=", 1)
        cookies[name.strip()] = value.strip()
    return cookies


def create_session(args: argparse.Namespace) -> requests.Session:
    if not args.cookie:
        raise SystemExit(
            "Missing cookie header. Provide it via --cookie, environment variables, or the .env file."
        )

    cookies = parse_cookie_string(args.cookie)
    if not cookies:
        raise SystemExit("Failed to parse any cookies from the supplied cookie string.")

    headers = build_headers(args)
    session = requests.Session()
    session.headers.update(headers)
    session.cookies.update(cookies)
    return session


def refresh_session(session: requests.Session) -> str:
    response = session.post(REFRESH_URL, data=b"", timeout=30)
    response.raise_for_status()

    try:
        payload = response.json()
    except ValueError as exc:
        raise SystemExit(f"Unexpected refresh response (non-JSON): {response.text!r}") from exc

    token = payload.get("result")
    if not token:
        raise SystemExit("Refresh response did not include a 'result' field; cannot update secret-token.")

    session.headers["secret-token"] = token
    return token


def fetch_transactions(args: argparse.Namespace) -> Dict:
    start = normalize_date(args.start_date)
    end = normalize_date(args.end_date)
    params = {
        "startDate": start.strftime("%Y%m%d"),
        "endDate": end.strftime("%Y%m%d"),
        "isLimitValidated": "false",
    }

    if args.refresh and not args.session_item:
        raise SystemExit(
            "The refresh endpoint requires the session-item header value. "
            "Provide it via --session-item, environment variables, or the .env file."
        )

    session = create_session(args)

    def perform_fetch() -> requests.Response:
        return session.get(BASE_URL, params=params, timeout=30)

    if args.refresh:
        refresh_session(session)

    response = perform_fetch()
    if response.status_code == 401:
        if not args.session_item:
            response.raise_for_status()
        refresh_session(session)
        response = perform_fetch()

    response.raise_for_status()
    return response.json()


def extract_env_path(argv: list[str]) -> str:
    """Return the path passed via --env-file (if any), otherwise '.env'."""
    flag = "--env-file"
    for idx, token in enumerate(argv):
        if token == flag and idx + 1 < len(argv):
            return argv[idx + 1]
        if token.startswith(f"{flag}="):
            return token.split("=", 1)[1]
    return ".env"


def load_env_file(path_str: str) -> None:
    """Populate os.environ with key=value pairs from the given .env file."""
    path = Path(path_str)
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value and (value[0], value[-1]) in {('"', '"'), ("'", "'")}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def main(argv: Optional[list[str]] = None) -> None:
    if argv is None:
        argv_list = sys.argv[1:]
    else:
        argv_list = list(argv)

    env_path = extract_env_path(argv_list)
    try:
        load_env_file(env_path)
    except OSError as exc:
        raise SystemExit(f"Failed to read env file {env_path!r}: {exc}") from exc

    args = parse_args(argv_list)
    data = fetch_transactions(args)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print(f"Saved response to {args.output}")
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as err:
        print(
            "HTTP error while fetching transactions.\n"
            "Check that your session cookie and secret headers are fresh.",
            file=sys.stderr,
        )
        raise SystemExit(err) from err
    except Exception as exc:  # pragma: no cover - top-level guard
        raise SystemExit(exc) from exc
