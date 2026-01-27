import os
import sys
import time
from typing import List

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


BASE_URL = os.getenv("BASE_URL", "http://localhost:8080")
HEADLESS = os.getenv("HEADLESS", "0") == "1"
TIMEOUT = int(os.getenv("TIMEOUT", "25"))


PROMPTS: List[str] = [
    (
        "أريد إطلاق مبادرة 'حي أخضر' في القاهرة الجديدة. سنركب ألواح شمسية ذكية فوق الأسطح مجاناً، "
        "ويدفع السكان اشتراكاً شهرياً أقل 30% من فاتورة الكهرباء. سنبيع الفائض للشبكة ونتكفل بالصيانة."
    ),
    (
        "I want to launch an AI legal assistant in Cairo, Egypt. It analyzes legal documents and predicts case outcomes."
    ),
]


def build_driver() -> webdriver.Chrome:
    chrome_options = Options()
    if HEADLESS:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--window-size=1400,900")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    return webdriver.Chrome(options=chrome_options)


def wait_for(driver: webdriver.Chrome, by: By, selector: str):
    return WebDriverWait(driver, TIMEOUT).until(EC.presence_of_element_located((by, selector)))


def wait_for_any(driver: webdriver.Chrome, by: By, selector: str):
    return WebDriverWait(driver, TIMEOUT).until(lambda d: len(d.find_elements(by, selector)) > 0)


def run_case(prompt: str) -> List[str]:
    errors: List[str] = []
    driver = build_driver()
    driver.get(BASE_URL)

    try:
        wait_for(driver, By.CSS_SELECTOR, "[data-testid='chat-input']")
    except Exception as exc:
        driver.quit()
        return [f"CHAT_INPUT_NOT_FOUND: {exc}"]

    # Send idea prompt
    input_box = driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-input']")
    input_box.clear()
    input_box.send_keys(prompt)
    send_btn = driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-send']")
    send_btn.click()

    # Wait for at least one system response
    try:
        wait_for_any(driver, By.CSS_SELECTOR, ".chat-message-system")
    except Exception as exc:
        errors.append(f"NO_SYSTEM_RESPONSE: {exc}")

    # Try to start the simulation
    input_box = driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-input']")
    input_box.clear()
    input_box.send_keys("go")
    driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-send']").click()

    # Switch to reasoning tab
    try:
        driver.find_element(By.CSS_SELECTOR, "[data-testid='tab-reasoning']").click()
    except Exception as exc:
        errors.append(f"REASONING_TAB_NOT_CLICKABLE: {exc}")

    # Expect reasoning messages after start
    try:
        wait_for_any(driver, By.CSS_SELECTOR, "[data-testid='reasoning-messages'] .animate-slide-in-right")
    except Exception as exc:
        errors.append(f"NO_REASONING_MESSAGES: {exc}")

    # Check metrics are visible
    for metric in ["metric-total-agents", "metric-acceptance-rate"]:
        try:
            wait_for(driver, By.CSS_SELECTOR, f"[data-testid='{metric}']")
        except Exception as exc:
            errors.append(f"MISSING_METRIC_{metric.upper()}: {exc}")

    driver.quit()
    return errors


def main() -> int:
    all_errors: List[str] = []
    print(f"Running Selenium smoke tests against {BASE_URL}")
    for idx, prompt in enumerate(PROMPTS, start=1):
        print(f"\n[Case {idx}] Prompt: {prompt[:120]}...")
        errors = run_case(prompt)
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
