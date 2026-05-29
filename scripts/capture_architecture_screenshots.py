#!/usr/bin/env python3

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import websocket


BASE_URL = "http://localhost/doctor/?_ui=20260317b"
LOGIN_URL = "http://localhost/doctor/api/auth/login"
CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WINDOW_WIDTH = 1440
WINDOW_HEIGHT = 1180
REMOTE_PORT = 9333
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "architecture" / "screenshots"


PAGES = [
    ("overview", "overview.png", "Overview"),
    ("setup-center", "setup-center.png", "Setup Center"),
    ("monthly-intake", "monthly-intake.png", "Monthly Intake"),
    ("calculation-review", "calculation-review.png", "Calculation Review"),
    ("payout-center", "payout-center.png", "Payout Center"),
    ("reports", "reports.png", "Reports"),
    ("support", "support.png", "Support"),
]


class CDPClient:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self.message_id = 0

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass

    def send(self, method: str, params: dict | None = None) -> dict:
        self.message_id += 1
        payload = {"id": self.message_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            raw = self.ws.recv()
            data = json.loads(raw)
            if data.get("id") == self.message_id:
                if "error" in data:
                    raise RuntimeError(f"CDP error for {method}: {data['error']}")
                return data.get("result", {})

    def eval(self, expression: str) -> dict:
        return self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
        )


def http_json(url: str, *, method: str = "GET", body: dict | None = None) -> dict:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_debug_endpoint(port: int, timeout_seconds: int = 20) -> list[dict]:
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
                if isinstance(data, list) and data:
                    return data
        except Exception as error:  # noqa: BLE001
            last_error = error
        time.sleep(0.5)
    raise RuntimeError(f"Chrome DevTools endpoint did not start: {last_error}")


def create_page_target(port: int, url: str) -> dict:
    endpoint = f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote(url, safe=':/?=&')}"
    request = urllib.request.Request(endpoint, method="PUT")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_text(client: CDPClient, expected_text: str, timeout_seconds: int = 20) -> None:
    deadline = time.time() + timeout_seconds
    expression = f"""
      (() => {{
        const text = (document.body && document.body.innerText) || '';
        return text.includes({json.dumps(expected_text)});
      }})()
    """
    while time.time() < deadline:
        result = client.eval(expression)
        if result.get("result", {}).get("value") is True:
            return
        time.sleep(0.4)
    raise RuntimeError(f"Timed out waiting for page text: {expected_text}")


def wait_for_ready_state(client: CDPClient, timeout_seconds: int = 20) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        result = client.eval("document.readyState")
        if result.get("result", {}).get("value") == "complete":
            return
        time.sleep(0.2)
    raise RuntimeError("Timed out waiting for document readyState=complete")


def set_auth_and_reload(client: CDPClient, token: str, user: dict) -> None:
    script = f"""
      (() => {{
        localStorage.setItem('rrcp_token', {json.dumps(token)});
        localStorage.setItem('rrcp_user', JSON.stringify({json.dumps(user)}));
        location.href = {json.dumps(BASE_URL)};
      }})()
    """
    client.eval(script)


def click_nav(client: CDPClient, page_id: str) -> None:
    script = f"""
      (() => {{
        const btn = document.querySelector('[data-nav="{page_id}"]');
        if (!btn) return false;
        btn.click();
        return true;
      }})()
    """
    result = client.eval(script)
    if result.get("result", {}).get("value") is not True:
        raise RuntimeError(f"Navigation button not found: {page_id}")


def capture_png(client: CDPClient, output_path: Path) -> None:
    screenshot = client.send(
        "Page.captureScreenshot",
        {
            "format": "png",
            "captureBeyondViewport": False,
            "fromSurface": True,
        },
    )
    png_bytes = base64.b64decode(screenshot["data"])
    output_path.write_bytes(png_bytes)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    login_data = http_json(
        LOGIN_URL,
        method="POST",
        body={"email": "admin@rrcp.local", "password": "Admin@123"},
    )
    token = login_data.get("token")
    user = login_data.get("user")
    if not token or not isinstance(user, dict):
        raise RuntimeError("Could not log in to capture screenshots")

    temp_profile = Path(tempfile.mkdtemp(prefix="rrcp-capture-"))
    chrome_cmd = [
        CHROME_PATH,
        f"--remote-debugging-port={REMOTE_PORT}",
        "--remote-allow-origins=*",
        f"--user-data-dir={temp_profile}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}",
        "about:blank",
    ]

    chrome_process = subprocess.Popen(
        chrome_cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    client = None
    try:
        wait_for_debug_endpoint(REMOTE_PORT)
        page_target = create_page_target(REMOTE_PORT, BASE_URL)
        ws_url = page_target.get("webSocketDebuggerUrl")
        if not ws_url:
            raise RuntimeError("Chrome did not expose a page websocket")

        client = CDPClient(ws_url)
        client.send("Page.enable")
        client.send("Runtime.enable")
        client.send(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": WINDOW_WIDTH,
                "height": WINDOW_HEIGHT,
                "deviceScaleFactor": 1,
                "mobile": False,
            },
        )
        client.send("Page.navigate", {"url": BASE_URL})
        wait_for_ready_state(client)
        wait_for_text(client, "Log in")
        set_auth_and_reload(client, token, user)
        wait_for_ready_state(client)
        wait_for_text(client, "Referral Revenue Calculation Platform")

        for page_id, filename, expected_text in PAGES:
            click_nav(client, page_id)
            wait_for_ready_state(client)
            wait_for_text(client, expected_text)
            client.eval(
                """
                  (() => {
                    const toast = document.getElementById('toast');
                    if (toast) toast.remove();
                    return true;
                  })()
                """
            )
            time.sleep(0.7)
            capture_png(client, OUTPUT_DIR / filename)
            print(f"Captured {filename}")

        return 0
    finally:
        if client is not None:
            client.close()
        chrome_process.terminate()
        try:
            chrome_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome_process.kill()
        shutil.rmtree(temp_profile, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as error:
        print(f"Capture failed: {error}", file=sys.stderr)
        raise
    except Exception as error:  # noqa: BLE001
        print(f"Capture failed: {error}", file=sys.stderr)
        raise
