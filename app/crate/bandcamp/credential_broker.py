from __future__ import annotations

import json
import os
import shutil
import shlex
import subprocess
import time
from typing import TypedDict

from crate.bandcamp.client import BandcampClientError, session_material_from_payload
from crate.bandcamp.models import (
    BandcampCredentialLoginResult,
    BandcampSessionMaterial,
)


class BandcampCredentialBridgeDisabled(RuntimeError):
    pass


class BandcampCredentialBridgeChallenge(RuntimeError):
    pass


class BandcampCredentialBridgeStatus(TypedDict):
    enabled: bool
    ready: bool
    backend: str | None
    message: str | None


def credential_bridge_enabled() -> bool:
    value = os.environ.get("CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED", "")
    return value.lower() in {"1", "true", "yes", "on"}


def credential_bridge_status(
    *, validate_runtime: bool = False
) -> BandcampCredentialBridgeStatus:
    enabled = credential_bridge_enabled()
    backend = (
        os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_BACKEND", "browser")
        .strip()
        .lower()
    )
    command = os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_COMMAND", "").strip()
    if not enabled:
        return {
            "enabled": False,
            "ready": False,
            "backend": backend or None,
            "message": "Bandcamp credential bridge is disabled",
        }
    if backend == "command":
        return {
            "enabled": True,
            "ready": bool(command),
            "backend": backend,
            "message": None
            if command
            else "Bandcamp credential bridge command is not configured",
        }
    if backend in {"browser", "selenium"}:
        if not validate_runtime:
            return {
                "enabled": True,
                "ready": True,
                "backend": backend,
                "message": None,
            }
        try:
            import selenium  # noqa: F401
        except ImportError:
            return {
                "enabled": True,
                "ready": False,
                "backend": backend,
                "message": "Bandcamp browser bridge requires selenium in the worker image",
            }
        browser_binary = _browser_binary_path()
        driver_binary = _chromedriver_binary_path()
        if not browser_binary:
            return {
                "enabled": True,
                "ready": False,
                "backend": backend,
                "message": "Bandcamp browser bridge could not find Chromium",
            }
        if not driver_binary:
            return {
                "enabled": True,
                "ready": False,
                "backend": backend,
                "message": "Bandcamp browser bridge could not find ChromeDriver",
            }
        return {
            "enabled": True,
            "ready": True,
            "backend": backend,
            "message": None,
        }
    if backend == "native":
        return {
            "enabled": True,
            "ready": False,
            "backend": backend,
            "message": "Bandcamp credential bridge native backend is not implemented yet",
        }
    return {
        "enabled": True,
        "ready": False,
        "backend": backend or None,
        "message": "Bandcamp credential bridge backend is not configured",
    }


def login_with_credentials(
    *, email: str, password: str
) -> BandcampCredentialLoginResult:
    """Run the web credential bridge.

    The bridge is intentionally isolated behind this function so the API never
    imports browser automation. A real browser backend will live in the worker
    image; until configured, the task fails safely instead of pretending auth
    succeeded.
    """
    if not credential_bridge_enabled():
        raise BandcampCredentialBridgeDisabled("Bandcamp credential bridge is disabled")

    backend = (
        os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_BACKEND", "browser")
        .strip()
        .lower()
    )
    if backend == "command":
        return _login_with_command_backend(email=email, password=password)

    if backend in {"browser", "selenium"}:
        return _login_with_browser_backend(email=email, password=password)

    if backend != "native":
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp credential bridge backend is not configured"
        )

    raise BandcampCredentialBridgeChallenge(
        "Bandcamp credential bridge native backend is not implemented yet"
    )


def _login_with_command_backend(
    *, email: str, password: str
) -> BandcampCredentialLoginResult:
    command = os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_COMMAND", "").strip()
    if not command:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp credential bridge command is not configured"
        )
    timeout = float(os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_TIMEOUT", "120"))
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    try:
        completed = subprocess.run(
            shlex.split(command),
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp credential bridge timed out"
        ) from exc

    if completed.returncode != 0:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp credential bridge command failed"
        )

    try:
        result = json.loads(completed.stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp credential bridge returned invalid JSON"
        ) from exc

    status = str(result.get("status") or "").strip() or "failed"
    if status == "connected":
        try:
            session = session_material_from_payload(result.get("session") or {})
        except BandcampClientError as exc:
            raise BandcampCredentialBridgeChallenge(str(exc)) from exc
        return BandcampCredentialLoginResult(status="connected", session=session)
    if status == "challenge_required":
        return BandcampCredentialLoginResult(
            status="challenge_required",
            message=str(result.get("message") or "Bandcamp requires manual challenge"),
            challenge_url=str(result.get("challenge_url") or ""),
        )
    return BandcampCredentialLoginResult(
        status="failed",
        message=str(result.get("message") or "Bandcamp credential bridge failed"),
    )


def _login_with_browser_backend(
    *, email: str, password: str
) -> BandcampCredentialLoginResult:
    try:
        from selenium import webdriver
        from selenium.common.exceptions import TimeoutException, WebDriverException
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.support import expected_conditions as ec
        from selenium.webdriver.support.ui import WebDriverWait
    except ImportError as exc:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp browser bridge requires selenium in the worker image"
        ) from exc

    timeout = float(os.environ.get("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_TIMEOUT", "120"))
    login_url = os.environ.get(
        "CRATE_BANDCAMP_LOGIN_URL", "https://bandcamp.com/login"
    ).strip()
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1280,960")
    options.add_argument("--lang=en-US")
    options.add_argument("--user-agent=" + _bandcamp_browser_user_agent())
    binary = _browser_binary_path()
    if binary:
        options.binary_location = binary

    driver_binary = _chromedriver_binary_path()
    service = Service(executable_path=driver_binary) if driver_binary else Service()

    try:
        driver = webdriver.Chrome(service=service, options=options)
    except WebDriverException as exc:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp browser bridge could not start Chromium"
        ) from exc

    try:
        driver.set_page_load_timeout(timeout)
        driver.get(login_url)
        wait = WebDriverWait(driver, min(timeout, 60.0))
        username_input = wait.until(
            ec.presence_of_element_located(
                (
                    By.CSS_SELECTOR,
                    "#username-field,input[name='username'],input[type='email']",
                )
            )
        )
        password_input = wait.until(
            ec.presence_of_element_located(
                (By.CSS_SELECTOR, "#password-field,input[name='password']")
            )
        )
        username_input.clear()
        username_input.send_keys(email)
        password_input.clear()
        password_input.send_keys(password)
        if not _click_first_submit(driver):
            password_input.send_keys(Keys.RETURN)
        return _wait_for_browser_login(driver, timeout=timeout)
    except TimeoutException as exc:
        raise BandcampCredentialBridgeChallenge(
            "Bandcamp login form did not load in time"
        ) from exc
    finally:
        driver.quit()


def _click_first_submit(driver) -> bool:
    from selenium.common.exceptions import WebDriverException
    from selenium.webdriver.common.by import By

    for selector in (
        "form#loginform button[type='submit']",
        "form#loginform input[type='submit']",
        "button[type='submit']",
        "input[type='submit']",
    ):
        matches = driver.find_elements(By.CSS_SELECTOR, selector)
        for match in matches:
            if match.is_displayed() and match.is_enabled():
                try:
                    match.click()
                    return True
                except WebDriverException:
                    if _submit_with_javascript(driver, match):
                        return True
    return False


def _submit_with_javascript(driver, element) -> bool:
    try:
        driver.execute_script(
            """
            const element = arguments[0];
            const form = element.closest("form");
            if (form && typeof form.requestSubmit === "function") {
              form.requestSubmit(element);
            } else if (form) {
              form.submit();
            } else {
              element.click();
            }
            """,
            element,
        )
    except Exception:
        return False
    return True


def _wait_for_browser_login(driver, *, timeout: float) -> BandcampCredentialLoginResult:
    deadline = time.monotonic() + timeout
    last_message = "Bandcamp browser login did not complete"
    while time.monotonic() < deadline:
        session = _session_material_from_driver(driver)
        if session.cookies:
            try:
                from crate.bandcamp.web import BandcampWebClient

                identity = BandcampWebClient(session, timeout=10.0).validate_session()
                return BandcampCredentialLoginResult(
                    status="connected",
                    session=BandcampSessionMaterial(
                        cookies=session.cookies,
                        profile=identity,
                        raw={"source": "selenium"},
                    ),
                )
            except Exception as exc:
                last_message = str(exc)

        page = (driver.page_source or "").lower()
        if "captcha" in page or "challenge" in page or "verification" in page:
            return BandcampCredentialLoginResult(
                status="challenge_required",
                message="Bandcamp requires a browser challenge before Crate can connect",
                challenge_url=driver.current_url,
            )
        if "incorrect" in page or "try again" in page or "couldn't log you in" in page:
            return BandcampCredentialLoginResult(
                status="failed",
                message="Bandcamp rejected those credentials",
            )
        time.sleep(1.0)

    return BandcampCredentialLoginResult(status="failed", message=last_message)


def _session_material_from_driver(driver) -> BandcampSessionMaterial:
    cookies: dict[str, str] = {}
    for cookie in driver.get_cookies():
        name = str(cookie.get("name") or "").strip()
        value = str(cookie.get("value") or "")
        if name and value:
            cookies[name] = value
    return BandcampSessionMaterial(cookies=cookies, raw={"source": "selenium"})


def _bandcamp_browser_user_agent() -> str:
    return (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )


def _browser_binary_path() -> str:
    return _first_existing_executable(
        os.environ.get("CRATE_BANDCAMP_BROWSER_BINARY", "").strip(),
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
    )


def _chromedriver_binary_path() -> str:
    return _first_existing_executable(
        os.environ.get("CRATE_BANDCAMP_CHROMEDRIVER_BINARY", "").strip(),
        "chromedriver",
    )


def _first_existing_executable(*candidates: str) -> str:
    for candidate in candidates:
        if not candidate:
            continue
        if os.path.isabs(candidate) and os.access(candidate, os.X_OK):
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    return ""
