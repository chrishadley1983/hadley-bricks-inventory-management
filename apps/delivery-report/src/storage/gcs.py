"""Google Cloud Storage — upload report files to GCS bucket."""

import logging
from datetime import datetime

from google.cloud import storage

from src.config import GCS_BUCKET

log = logging.getLogger(__name__)


def upload_report(html_content: str, pdf_bytes: bytes, date_str: str | None = None) -> dict:
    """
    Upload HTML and PDF report files to GCS.

    Returns:
        Dict with html_uri and pdf_uri
    """
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)

    html_blob_name = f"reports/{date_str}/Amazon_Delivery_Report_{date_str}.html"
    pdf_blob_name = f"reports/{date_str}/Amazon_Delivery_Report_{date_str}.pdf"

    html_blob = bucket.blob(html_blob_name)
    html_blob.upload_from_string(html_content, content_type="text/html")
    log.info("Uploaded HTML report to gs://%s/%s", GCS_BUCKET, html_blob_name)

    pdf_blob = bucket.blob(pdf_blob_name)
    pdf_blob.upload_from_string(pdf_bytes, content_type="application/pdf")
    log.info("Uploaded PDF report to gs://%s/%s", GCS_BUCKET, pdf_blob_name)

    return {
        "html_uri": f"gs://{GCS_BUCKET}/{html_blob_name}",
        "pdf_uri": f"gs://{GCS_BUCKET}/{pdf_blob_name}",
    }
