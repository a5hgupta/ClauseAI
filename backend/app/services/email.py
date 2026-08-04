"""
Real SMTP sending when SMTP_HOST is configured. In local dev, when no SMTP
is configured, we log the email to stdout instead of silently failing —
this keeps the verification/reset flow testable without an SMTP server,
without pretending an email was sent when it wasn't.
"""
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.core.config import settings

logger = logging.getLogger("clauseiq.email")


def _send(to_email: str, subject: str, html_body: str) -> None:
    if not settings.SMTP_HOST:
        logger.warning(
            "SMTP not configured — email NOT sent. To=%s Subject=%s\n%s",
            to_email, subject, html_body,
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.starttls()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, [to_email], msg.as_string())


def send_verification_email(to_email: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    _send(
        to_email,
        "Verify your ClauseIQ email",
        f"""<p>Welcome to ClauseIQ.</p>
        <p><a href="{link}">Click here to verify your email</a> (expires in 24 hours).</p>
        <p>If the link doesn't work, paste this into your browser:<br>{link}</p>""",
    )


def send_password_reset_email(to_email: str, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    _send(
        to_email,
        "Reset your ClauseIQ password",
        f"""<p>We received a request to reset your password.</p>
        <p><a href="{link}">Click here to reset it</a> (expires in 1 hour).</p>
        <p>If you didn't request this, you can safely ignore this email.</p>""",
    )
