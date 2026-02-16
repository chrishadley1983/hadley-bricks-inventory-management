# Google Cloud Scheduler Setup for Hadley Bricks

This directory contains the configuration for migrating scheduled jobs from GitHub Actions to Google Cloud Scheduler.

## Overview

| Job Type | Jobs | Approach |
|----------|------|----------|
| **Fire-and-forget** | Amazon Two-Phase, eBay Negotiation, Vinted Cleanup, Refresh Watchlist | GCS -> Vercel API directly |
| **Resumable** | Amazon Pricing, eBay Pricing, BrickLink Pricing | GCS -> Cloud Function (retry driver) -> Vercel API |

## Prerequisites

- Google Cloud SDK installed (`gcloud` CLI)
- Existing GCP project (same as Google Sheets integration)
- `CRON_SECRET` value from Vercel environment variables

## Setup Instructions

### Step 1: Set Project and Enable APIs

```bash
# Set your project ID (use existing project from Google Sheets integration)
export GCP_PROJECT="your-project-id"
gcloud config set project $GCP_PROJECT

# Enable required APIs
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### Step 2: Create Secret for CRON_SECRET

```bash
# Create the secret (replace YOUR_CRON_SECRET_VALUE with actual value from Vercel)
echo -n "YOUR_CRON_SECRET_VALUE" | gcloud secrets create hadley-bricks-cron-secret --data-file=-

# Verify secret was created
gcloud secrets list
```

### Step 3: Create Service Account

```bash
# Create service account for Cloud Scheduler
gcloud iam service-accounts create hadley-scheduler-sa \
  --display-name="Hadley Bricks Scheduler Service Account"

# Grant permissions to invoke Cloud Functions
gcloud projects add-iam-policy-binding $GCP_PROJECT \
  --member="serviceAccount:hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com" \
  --role="roles/cloudfunctions.invoker"

# Grant permissions to access secrets
gcloud projects add-iam-policy-binding $GCP_PROJECT \
  --member="serviceAccount:hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Step 4: Deploy Cloud Function (for resumable jobs)

```bash
# Deploy from the functions directory
cd gcp/functions/pricing-sync-driver

gcloud functions deploy pricing-sync-driver \
  --gen2 \
  --runtime=nodejs20 \
  --region=europe-west2 \
  --source=. \
  --entry-point=pricingSyncDriver \
  --trigger-http \
  --allow-unauthenticated=false \
  --timeout=3600 \
  --memory=256MB \
  --set-env-vars="APP_URL=https://hadley-bricks.vercel.app,GCP_PROJECT=$GCP_PROJECT"

# Get the function URL for scheduler jobs
gcloud functions describe pricing-sync-driver --gen2 --region=europe-west2 --format='value(serviceConfig.uri)'
```

### Step 5: Grant Function Permission to Access Secrets

```bash
# Get the Cloud Run service account used by the function
FUNCTION_SA=$(gcloud functions describe pricing-sync-driver --gen2 --region=europe-west2 --format='value(serviceConfig.serviceAccountEmail)')

# Grant secret access
gcloud secrets add-iam-policy-binding hadley-bricks-cron-secret \
  --member="serviceAccount:$FUNCTION_SA" \
  --role="roles/secretmanager.secretAccessor"
```

### Step 6: Create Cloud Scheduler Jobs

Set the Vercel app URL and cron secret:

```bash
export APP_URL="https://hadley-bricks.vercel.app"
export CRON_SECRET="YOUR_CRON_SECRET_VALUE"
export FUNCTION_URL=$(gcloud functions describe pricing-sync-driver --gen2 --region=europe-west2 --format='value(serviceConfig.uri)')
```

#### Fire-and-Forget Jobs (Direct to Vercel)

```bash
# Amazon Two-Phase Sync - every 5 minutes
gcloud scheduler jobs create http amazon-two-phase-sync \
  --location=europe-west2 \
  --schedule="*/5 * * * *" \
  --uri="$APP_URL/api/cron/amazon-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="Amazon two-phase order sync"

# eBay Negotiation Sync - 4x daily (8am, 12pm, 4pm, 8pm UTC)
gcloud scheduler jobs create http ebay-negotiation-sync \
  --location=europe-west2 \
  --schedule="0 8,12,16,20 * * *" \
  --uri="$APP_URL/api/cron/negotiation" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="eBay automated negotiation offers"

# Vinted Cleanup - daily at midnight UTC
gcloud scheduler jobs create http vinted-cleanup \
  --location=europe-west2 \
  --schedule="0 0 * * *" \
  --uri="$APP_URL/api/cron/vinted-cleanup" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="Vinted sold items cleanup"

# Refresh Watchlist - weekly on Sunday at 3am UTC
gcloud scheduler jobs create http refresh-watchlist \
  --location=europe-west2 \
  --schedule="0 3 * * 0" \
  --uri="$APP_URL/api/cron/refresh-watchlist" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="Weekly arbitrage watchlist refresh"

# Rebrickable Sync - weekly on Sunday at 4am UTC
gcloud scheduler jobs create http rebrickable-sync \
  --location=europe-west2 \
  --schedule="0 4 * * 0" \
  --uri="$APP_URL/api/cron/rebrickable-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="Weekly Rebrickable set data sync"

# Retirement Sync - daily at 6am UTC
gcloud scheduler jobs create http retirement-sync \
  --location=europe-west2 \
  --schedule="0 6 * * *" \
  --uri="$APP_URL/api/cron/retirement-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --attempt-deadline="300s" \
  --description="Daily retirement status sync (Brickset + Brick Tap)"

# Investment Sync - daily at 7am UTC (after retirement sync)
gcloud scheduler jobs create http investment-sync \
  --location=europe-west2 \
  --schedule="0 7 * * *" \
  --uri="$APP_URL/api/cron/investment-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --description="Daily investment classification sync (licensed/UCS/modular)"

# Investment Retrain - monthly on 1st at 5am UTC
gcloud scheduler jobs create http investment-retrain \
  --location=europe-west2 \
  --schedule="0 5 1 * *" \
  --uri="$APP_URL/api/cron/investment-retrain" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="UTC" \
  --attempt-deadline="300s" \
  --description="Monthly ML model retrain and investment scoring"

# Vinted Collections - daily at 8am UK time
gcloud scheduler jobs create http vinted-collections \
  --location=europe-west2 \
  --schedule="0 8 * * *" \
  --uri="$APP_URL/api/cron/vinted-collections" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="Europe/London" \
  --description="Daily Vinted parcel collection check"

# Vercel Usage Report - daily at 7am UK time
gcloud scheduler jobs create http vercel-usage-report \
  --location=europe-west2 \
  --schedule="0 7 * * *" \
  --uri="$APP_URL/api/cron/vercel-usage" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="Europe/London" \
  --description="Daily Vercel usage monitoring report"

# Cost Allocation - daily at 9:15pm UK time
gcloud scheduler jobs create http cost-allocation \
  --location=europe-west2 \
  --schedule="15 21 * * *" \
  --uri="$APP_URL/api/cron/cost-allocation" \
  --http-method=POST \
  --headers="Authorization=Bearer $CRON_SECRET,Content-Type=application/json" \
  --time-zone="Europe/London" \
  --attempt-deadline="300s" \
  --description="Daily proportional cost allocation across purchase items"
```

#### Resumable Jobs (via Cloud Function Driver)

```bash
# eBay Pricing Sync - daily at 2am UTC
gcloud scheduler jobs create http ebay-pricing-sync \
  --location=europe-west2 \
  --schedule="0 2 * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"jobType":"ebay-pricing"}' \
  --time-zone="UTC" \
  --attempt-deadline="3600s" \
  --oidc-service-account-email="hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com" \
  --description="Daily eBay pricing sync (resumable)"

# BrickLink Pricing Sync - daily at 2:30am UTC
gcloud scheduler jobs create http bricklink-pricing-sync \
  --location=europe-west2 \
  --schedule="30 2 * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"jobType":"bricklink-pricing"}' \
  --time-zone="UTC" \
  --attempt-deadline="3600s" \
  --oidc-service-account-email="hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com" \
  --description="Daily BrickLink pricing sync (resumable)"

# Amazon Pricing Sync - daily at 4am UTC
gcloud scheduler jobs create http amazon-pricing-sync \
  --location=europe-west2 \
  --schedule="0 4 * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"jobType":"amazon-pricing"}' \
  --time-zone="UTC" \
  --attempt-deadline="3600s" \
  --oidc-service-account-email="hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com" \
  --description="Daily Amazon pricing sync (resumable)"
```

## Verification

### List All Jobs

```bash
gcloud scheduler jobs list --location=europe-west2
```

### Test Individual Jobs

```bash
# Fire-and-forget jobs
gcloud scheduler jobs run amazon-two-phase-sync --location=europe-west2
gcloud scheduler jobs run ebay-negotiation-sync --location=europe-west2
gcloud scheduler jobs run vinted-cleanup --location=europe-west2
gcloud scheduler jobs run refresh-watchlist --location=europe-west2

# Investment pipeline jobs
gcloud scheduler jobs run rebrickable-sync --location=europe-west2
gcloud scheduler jobs run retirement-sync --location=europe-west2
gcloud scheduler jobs run investment-sync --location=europe-west2
gcloud scheduler jobs run investment-retrain --location=europe-west2

# Notification jobs
gcloud scheduler jobs run vinted-collections --location=europe-west2

# Monitoring jobs
gcloud scheduler jobs run vercel-usage-report --location=europe-west2

# Resumable jobs (these take longer)
gcloud scheduler jobs run ebay-pricing-sync --location=europe-west2
gcloud scheduler jobs run bricklink-pricing-sync --location=europe-west2
gcloud scheduler jobs run amazon-pricing-sync --location=europe-west2
```

### Check Cloud Function Logs

```bash
gcloud functions logs read pricing-sync-driver --gen2 --region=europe-west2 --limit=50
```

### Check Scheduler Job History

```bash
gcloud scheduler jobs describe amazon-two-phase-sync --location=europe-west2
```

## Parallel Testing Period

Run both GCS and GitHub Actions for 3-5 days:

1. GCS jobs are created and running
2. Keep GitHub Actions workflows enabled
3. Monitor both systems for successful execution
4. Compare results in `arbitrage_sync_status` table

## Disable GitHub Actions

After successful validation:

```bash
# In GitHub repository settings > Actions > General
# Disable the following workflows:
# - amazon-sync-cron.yml
# - negotiation-cron.yml
# - vinted-cleanup-cron.yml
# - amazon-pricing-cron.yml
# - ebay-pricing-cron.yml
# - bricklink-pricing-cron.yml
```

Or disable via GitHub CLI:

```bash
gh workflow disable "Amazon Two-Phase Sync"
gh workflow disable "eBay Negotiation Sync"
gh workflow disable "Vinted Cleanup"
gh workflow disable "Amazon Pricing Sync"
gh workflow disable "eBay Pricing Sync"
gh workflow disable "BrickLink Pricing Sync"
```

## Rollback Plan

If issues occur:

```bash
# Pause all GCS jobs
gcloud scheduler jobs pause amazon-two-phase-sync --location=europe-west2
gcloud scheduler jobs pause ebay-negotiation-sync --location=europe-west2
gcloud scheduler jobs pause vinted-cleanup --location=europe-west2
gcloud scheduler jobs pause refresh-watchlist --location=europe-west2
gcloud scheduler jobs pause ebay-pricing-sync --location=europe-west2
gcloud scheduler jobs pause bricklink-pricing-sync --location=europe-west2
gcloud scheduler jobs pause amazon-pricing-sync --location=europe-west2

# Re-enable GitHub Actions workflows in repository settings
```

To resume GCS jobs:

```bash
gcloud scheduler jobs resume JOB_NAME --location=europe-west2
```

## Cleanup (After Successful Migration)

Delete GitHub Actions workflow files:

```bash
git rm .github/workflows/amazon-sync-cron.yml
git rm .github/workflows/negotiation-cron.yml
git rm .github/workflows/vinted-cleanup-cron.yml
git rm .github/workflows/amazon-pricing-cron.yml
git rm .github/workflows/ebay-pricing-cron.yml
git rm .github/workflows/bricklink-pricing-cron.yml
git commit -m "chore: Remove GitHub Actions cron workflows (migrated to GCS)"
git push
```

## Cost Estimate

| Component | Cost |
|-----------|------|
| Cloud Scheduler (7 jobs, 3 free) | ~$0.40/month |
| Cloud Functions (free tier) | $0.00 |
| Secret Manager (free tier) | $0.00 |
| **Total** | **~$0.40/month** |

## Troubleshooting

### Job Not Running

1. Check job is not paused: `gcloud scheduler jobs describe JOB_NAME --location=europe-west2`
2. Check service account permissions
3. Check Cloud Function logs for errors

### Authentication Errors

1. Verify CRON_SECRET matches between GCS and Vercel
2. Check service account has invoker permissions
3. For resumable jobs, ensure OIDC is configured correctly

### Function Timeout

The Cloud Function has a 1-hour timeout. If jobs consistently timeout:

1. Check Vercel API response times
2. Increase `MAX_ITERATIONS` in the function code
3. Check for API errors causing retries

### Secret Access Errors

```bash
# Verify secret exists
gcloud secrets versions access latest --secret="hadley-bricks-cron-secret"

# Check IAM bindings
gcloud secrets get-iam-policy hadley-bricks-cron-secret
```
