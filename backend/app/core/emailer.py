"""
Simple SMTP email sender for verification and password reset emails.
"""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Optional


def _smtp_config() -> Optional[dict]:
    host = os.getenv("SMTP_HOST") or ""
    if not host:
        return None
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587") or 587),
        "user": os.getenv("SMTP_USER") or "",
        "password": os.getenv("SMTP_PASSWORD") or "",
        "from_addr": os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "",
        "use_tls": os.getenv("SMTP_TLS", "true").lower() in {"1", "true", "yes"},
    }


def send_email(to_email: str, subject: str, body: str) -> bool:
    cfg = _smtp_config()
    if not cfg or not cfg.get("from_addr"):
        return False
    msg = EmailMessage()
    msg["From"] = cfg["from_addr"]
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(cfg["host"], cfg["port"]) as smtp:
            if cfg["use_tls"]:
                smtp.starttls()
            if cfg["user"] and cfg["password"]:
                smtp.login(cfg["user"], cfg["password"])
            smtp.send_message(msg)
        return True
    except Exception:
        return False


def send_verification_email(to_email: str, link: str) -> bool:
    app_name = os.getenv("APP_NAME") or "Agentic Simulator"
    subject = f"{app_name} - Verify your email"
    body = (
        f"Welcome to {app_name}!\n\n"
        "Please verify your email address by clicking the link below:\n"
        f"{link}\n\n"
        "If you did not create an account, you can ignore this email."
    )
    return send_email(to_email, subject, body)


def send_password_reset_email(to_email: str, link: str) -> bool:
    app_name = os.getenv("APP_NAME") or "Agentic Simulator"
    subject = f"{app_name} - Reset your password"
    body = (
        f"We received a request to reset your {app_name} password.\n\n"
        "Click the link below to choose a new password:\n"
        f"{link}\n\n"
        "If you did not request a reset, you can ignore this email."
    )
    return send_email(to_email, subject, body)
