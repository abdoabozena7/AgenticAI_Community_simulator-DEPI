import os
import re
import sys
import time
from typing import List, Tuple

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def _get_env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _get_env_int(name: str, default: int) -> int:
    value = os.getenv(name, str(default))
    try:
        return int(value)
    except ValueError:
        return default


def _parse_window_size(value: str) -> Tuple[int, int]:
    raw = (value or "").lower().replace("x", ",")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) != 2:
        return 1400, 900
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return 1400, 900


BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")
HEADLESS = _get_env_bool("HEADLESS", False)
TIMEOUT = _get_env_int("TIMEOUT", 25)
BROWSER = os.getenv("BROWSER", "chrome").strip().lower()
DRIVER_PATH = os.getenv("DRIVER_PATH", "").strip()
CHROME_BINARY = os.getenv("CHROME_BINARY", "").strip()
FIREFOX_BINARY = os.getenv("FIREFOX_BINARY", "").strip()
WINDOW_SIZE = os.getenv("WINDOW_SIZE", "1400,900").strip()
SCREENSHOT_DIR = os.getenv("SCREENSHOT_DIR", "").strip()


PROMPTS: List[str] = [
    (
        "أريد إطلاق مبادرة 'حي أخضر' في القاهرة الجديدة. سنركّب ألواح شمسية ذكية فوق الأسطح مجانًا، "
        "ويدفع السكان اشتراكًا شهريًا أقل 30% من فاتورة الكهرباء. سنبيع الفائض للشبكة ونتكفل بالصيانة."
    ),
    (
        "I want to launch an AI legal assistant in Cairo, Egypt. It analyzes legal documents and predicts case outcomes."
    ),
]


def build_driver() -> webdriver.Remote:
    width, height = _parse_window_size(WINDOW_SIZE)
    if BROWSER == "firefox":
        firefox_options = FirefoxOptions()
        if HEADLESS:
            firefox_options.add_argument("--headless")
        if FIREFOX_BINARY:
            firefox_options.binary_location = FIREFOX_BINARY
        service = FirefoxService(executable_path=DRIVER_PATH) if DRIVER_PATH else FirefoxService()
        driver = webdriver.Firefox(service=service, options=firefox_options)
        driver.set_window_size(width, height)
        return driver
    if BROWSER != "chrome":
        raise ValueError(f"Unsupported BROWSER='{BROWSER}'. Use 'chrome' or 'firefox'.")

    chrome_options = ChromeOptions()
    if HEADLESS:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument(f"--window-size={width},{height}")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    if CHROME_BINARY:
        chrome_options.binary_location = CHROME_BINARY
    service = ChromeService(executable_path=DRIVER_PATH) if DRIVER_PATH else ChromeService()
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.set_window_size(width, height)
    return driver


def wait_for(driver: webdriver.Remote, by: By, selector: str):
    return WebDriverWait(driver, TIMEOUT).until(EC.presence_of_element_located((by, selector)))


def wait_for_any(driver: webdriver.Remote, by: By, selector: str):
    return WebDriverWait(driver, TIMEOUT).until(lambda d: len(d.find_elements(by, selector)) > 0)


def wait_clickable(driver: webdriver.Remote, by: By, selector: str):
    return WebDriverWait(driver, TIMEOUT).until(EC.element_to_be_clickable((by, selector)))


def _sanitize_label(label: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", label or "")
    return cleaned.strip("_") or "case"


def _maybe_capture(driver: webdriver.Remote, label: str) -> None:
    if not SCREENSHOT_DIR:
        return
    try:
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        filename = f"{_sanitize_label(label)}-{stamp}.png"
        path = os.path.join(SCREENSHOT_DIR, filename)
        driver.save_screenshot(path)
    except Exception:
        return


def run_case(prompt: str, case_id: int) -> List[str]:
    errors: List[str] = []
    driver: webdriver.Remote | None = None
    try:
        driver = build_driver()
        driver.get(BASE_URL)

        try:
            wait_for(driver, By.CSS_SELECTOR, "[data-testid='chat-input']")
        except TimeoutException as exc:
            errors.append(f"CHAT_INPUT_NOT_FOUND: {exc}")
            return errors

        # Send idea prompt
        input_box = driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-input']")
        input_box.clear()
        input_box.send_keys(prompt)
        try:
            send_btn = wait_clickable(driver, By.CSS_SELECTOR, "[data-testid='chat-send']")
            send_btn.click()
        except TimeoutException as exc:
            errors.append(f"CHAT_SEND_NOT_CLICKABLE: {exc}")
            return errors

        # Wait for at least one system response
        try:
            wait_for_any(driver, By.CSS_SELECTOR, ".chat-message-system")
        except TimeoutException as exc:
            errors.append(f"NO_SYSTEM_RESPONSE: {exc}")

        # Try to start the simulation
        input_box = driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-input']")
        input_box.clear()
        input_box.send_keys("go")
        try:
            wait_clickable(driver, By.CSS_SELECTOR, "[data-testid='chat-send']").click()
        except TimeoutException as exc:
            errors.append(f"SIMULATION_START_NOT_CLICKABLE: {exc}")

        # Switch to reasoning tab
        try:
            wait_clickable(driver, By.CSS_SELECTOR, "[data-testid='tab-reasoning']").click()
        except TimeoutException as exc:
            errors.append(f"REASONING_TAB_NOT_CLICKABLE: {exc}")

        # Expect reasoning messages after start
        try:
            wait_for_any(driver, By.CSS_SELECTOR, "[data-testid='reasoning-messages'] .animate-slide-in-right")
        except TimeoutException as exc:
            errors.append(f"NO_REASONING_MESSAGES: {exc}")

        # Check metrics are visible
        for metric in ["metric-total-agents", "metric-acceptance-rate"]:
            try:
                wait_for(driver, By.CSS_SELECTOR, f"[data-testid='{metric}']")
            except TimeoutException as exc:
                errors.append(f"MISSING_METRIC_{metric.upper()}: {exc}")
    except Exception as exc:
        errors.append(f"UNEXPECTED_ERROR: {exc}")
    finally:
        if driver is not None:
            if errors:
                _maybe_capture(driver, f"case-{case_id}")
            try:
                driver.quit()
            except Exception:
                pass
    return errors


def main() -> int:
    all_errors: List[str] = []
    print(f"Running Selenium smoke tests against {BASE_URL}")
    print(f"Browser: {BROWSER} | Headless: {HEADLESS} | Timeout: {TIMEOUT}s | Window: {WINDOW_SIZE}")
    for idx, prompt in enumerate(PROMPTS, start=1):
        print(f"\n[Case {idx}] Prompt: {prompt[:120]}...")
        errors = run_case(prompt, idx)
        if errors:
            all_errors.extend([f"Case {idx}: {err}" for err in errors])
            print("  FAIL")
            for err in errors:
                print(f"   - {err}")
        else:
            print("  PASS")

    if all_errors:
        print("\nFailures detected:")
        for err in all_errors:
            print(f"- {err}")
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
