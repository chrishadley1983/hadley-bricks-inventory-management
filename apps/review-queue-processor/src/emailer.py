"""Gmail SMTP email sender — adapted from delivery-report."""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from src.config import SMTP_APP_PASSWORD, SMTP_RECIPIENT, SMTP_SENDER

log = logging.getLogger(__name__)


def send_report(subject: str, html_body: str) -> None:
    """Send an HTML email report."""
    msg = MIMEMultipart("alternative")
    msg["From"] = SMTP_SENDER
    msg["To"] = SMTP_RECIPIENT
    msg["Subject"] = subject

    msg.attach(MIMEText(html_body, "html"))

    password = SMTP_APP_PASSWORD.replace(" ", "")

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(SMTP_SENDER, password)
        server.sendmail(SMTP_SENDER, [SMTP_RECIPIENT], msg.as_string())

    log.info("Email sent to %s — subject: %s", SMTP_RECIPIENT, subject)
