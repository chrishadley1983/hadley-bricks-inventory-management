"""WeasyPrint HTML-to-PDF converter."""

import logging

from weasyprint import HTML

log = logging.getLogger(__name__)


def html_to_pdf(html_content: str) -> bytes:
    """Convert an HTML string to PDF bytes."""
    log.info("Converting HTML report to PDF")
    return HTML(string=html_content).write_pdf()
