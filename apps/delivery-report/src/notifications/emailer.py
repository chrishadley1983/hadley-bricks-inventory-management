"""Gmail SMTP email sender — reads credentials from environment variables."""

import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from src.config import SMTP_APP_PASSWORD, SMTP_RECIPIENT, SMTP_SENDER

log = logging.getLogger(__name__)


def send_report(
    subject: str,
    html_body: str,
    pdf_bytes: bytes | None = None,
    pdf_filename: str = "report.pdf",
) -> None:
    """Send an HTML email with an optional PDF attachment."""
    if pdf_bytes:
        msg = MIMEMultipart("mixed")
    else:
        msg = MIMEMultipart("alternative")

    msg["From"] = SMTP_SENDER
    msg["To"] = SMTP_RECIPIENT
    msg["Subject"] = subject

    msg.attach(MIMEText(html_body, "html"))

    if pdf_bytes:
        attachment = MIMEApplication(pdf_bytes)
        attachment.add_header("Content-Disposition", "attachment", filename=pdf_filename)
        msg.attach(attachment)

    password = SMTP_APP_PASSWORD.replace(" ", "")

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(SMTP_SENDER, password)
        server.sendmail(SMTP_SENDER, [SMTP_RECIPIENT], msg.as_string())

    log.info("Email sent to %s — subject: %s", SMTP_RECIPIENT, subject)


def send_failure_alert(error_message: str) -> None:
    """Send a failure alert email when the pipeline fails."""
    html = f"""<h2>Delivery Report FAILED</h2>
<p style="color:#991B1B;font-weight:600;">{error_message}</p>
<p>The daily delivery report could not be generated. Check Cloud Run logs for details.</p>
<p>Will retry on next scheduled run.</p>"""

    try:
        send_report(
            subject="FAILED: Delivery Report",
            html_body=html,
        )
    except Exception as e:
        log.error("Failed to send failure alert email: %s", e)
