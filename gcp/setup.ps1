# Hadley Bricks - Google Cloud Scheduler Setup Script
# Run this script in PowerShell after setting the variables below

# ============================================================================
# CONFIGURATION - Update these values before running
# ============================================================================

$GCP_PROJECT = "gen-lang-client-0823893317"  # Hadley Bricks Admin
$CRON_SECRET = "Emmie2018!!!"                # CRON_SECRET from Vercel env vars
$APP_URL = "https://hadley-bricks-inventory-management.vercel.app"
$REGION = "europe-west2"

# ============================================================================
# DO NOT MODIFY BELOW THIS LINE
# ============================================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Hadley Bricks - GCP Scheduler Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "Error: gcloud CLI is not installed. Please install Google Cloud SDK first." -ForegroundColor Red
    exit 1
}

# Set project
Write-Host "Setting GCP project to: $GCP_PROJECT" -ForegroundColor Yellow
gcloud config set project $GCP_PROJECT

# Step 1: Enable APIs
Write-Host ""
Write-Host "Step 1: Enabling required APIs..." -ForegroundColor Green
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Step 2: Create secret
Write-Host ""
Write-Host "Step 2: Creating CRON_SECRET in Secret Manager..." -ForegroundColor Green
$CRON_SECRET | gcloud secrets create hadley-bricks-cron-secret --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Secret may already exist, updating..." -ForegroundColor Yellow
    $CRON_SECRET | gcloud secrets versions add hadley-bricks-cron-secret --data-file=-
}

# Step 3: Create service account
Write-Host ""
Write-Host "Step 3: Creating service account..." -ForegroundColor Green
gcloud iam service-accounts create hadley-scheduler-sa --display-name="Hadley Bricks Scheduler Service Account" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Service account may already exist, continuing..." -ForegroundColor Yellow
}

$SERVICE_ACCOUNT = "hadley-scheduler-sa@$GCP_PROJECT.iam.gserviceaccount.com"

# Grant permissions
gcloud projects add-iam-policy-binding $GCP_PROJECT --member="serviceAccount:$SERVICE_ACCOUNT" --role="roles/cloudfunctions.invoker" --quiet
gcloud projects add-iam-policy-binding $GCP_PROJECT --member="serviceAccount:$SERVICE_ACCOUNT" --role="roles/secretmanager.secretAccessor" --quiet

# Step 4: Deploy Cloud Function
Write-Host ""
Write-Host "Step 4: Deploying Cloud Function..." -ForegroundColor Green
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$FUNCTION_DIR = Join-Path $SCRIPT_DIR "functions\pricing-sync-driver"

Push-Location $FUNCTION_DIR
gcloud functions deploy pricing-sync-driver `
    --gen2 `
    --runtime=nodejs20 `
    --region=$REGION `
    --source=. `
    --entry-point=pricingSyncDriver `
    --trigger-http `
    --no-allow-unauthenticated `
    --timeout=3600 `
    --memory=256MB `
    --set-env-vars="APP_URL=$APP_URL,GCP_PROJECT=$GCP_PROJECT"
Pop-Location

# Get function URL
$FUNCTION_URL = gcloud functions describe pricing-sync-driver --gen2 --region=$REGION --format='value(serviceConfig.uri)'
Write-Host "Cloud Function URL: $FUNCTION_URL" -ForegroundColor Cyan

# Step 5: Grant function access to secrets
Write-Host ""
Write-Host "Step 5: Granting function access to secrets..." -ForegroundColor Green
$FUNCTION_SA = gcloud functions describe pricing-sync-driver --gen2 --region=$REGION --format='value(serviceConfig.serviceAccountEmail)'
gcloud secrets add-iam-policy-binding hadley-bricks-cron-secret --member="serviceAccount:$FUNCTION_SA" --role="roles/secretmanager.secretAccessor" --quiet

# Step 6: Create Scheduler Jobs
Write-Host ""
Write-Host "Step 6: Creating Cloud Scheduler jobs..." -ForegroundColor Green

# Helper function to create or update a job
function Create-SchedulerJob {
    param (
        [string]$Name,
        [string]$Schedule,
        [string]$Uri,
        [string]$Description,
        [string]$Body = "",
        [bool]$UseOIDC = $false
    )

    Write-Host "  Creating job: $Name" -ForegroundColor Yellow

    # Delete existing job if it exists
    gcloud scheduler jobs delete $Name --location=$REGION --quiet 2>$null

    $args = @(
        "scheduler", "jobs", "create", "http", $Name,
        "--location=$REGION",
        "--schedule=$Schedule",
        "--uri=$Uri",
        "--http-method=POST",
        "--time-zone=UTC",
        "--description=$Description"
    )

    if ($UseOIDC) {
        $args += "--oidc-service-account-email=$SERVICE_ACCOUNT"
        $args += "--headers=Content-Type=application/json"
        $args += "--message-body=$Body"
        $args += "--attempt-deadline=3600s"
    } else {
        $args += "--headers=Authorization=Bearer $CRON_SECRET,Content-Type=application/json"
    }

    & gcloud @args
}

# Fire-and-forget jobs (direct to Vercel)
Create-SchedulerJob -Name "amazon-two-phase-sync" -Schedule "*/5 * * * *" -Uri "$APP_URL/api/cron/amazon-sync" -Description "Amazon two-phase order sync"
Create-SchedulerJob -Name "ebay-negotiation-sync" -Schedule "0 8,12,16,20 * * *" -Uri "$APP_URL/api/cron/negotiation" -Description "eBay automated negotiation offers"
Create-SchedulerJob -Name "vinted-cleanup" -Schedule "0 0 * * *" -Uri "$APP_URL/api/cron/vinted-cleanup" -Description "Vinted sold items cleanup"
Create-SchedulerJob -Name "refresh-watchlist" -Schedule "0 3 * * 0" -Uri "$APP_URL/api/cron/refresh-watchlist" -Description "Weekly arbitrage watchlist refresh"

# Resumable jobs (via Cloud Function driver)
Create-SchedulerJob -Name "ebay-pricing-sync" -Schedule "0 2 * * *" -Uri $FUNCTION_URL -Description "Daily eBay pricing sync (resumable)" -Body '{"jobType":"ebay-pricing"}' -UseOIDC $true
Create-SchedulerJob -Name "bricklink-pricing-sync" -Schedule "30 2 * * *" -Uri $FUNCTION_URL -Description "Daily BrickLink pricing sync (resumable)" -Body '{"jobType":"bricklink-pricing"}' -UseOIDC $true
Create-SchedulerJob -Name "amazon-pricing-sync" -Schedule "0 4 * * *" -Uri $FUNCTION_URL -Description "Daily Amazon pricing sync (resumable)" -Body '{"jobType":"amazon-pricing"}' -UseOIDC $true

# Additional fire-and-forget jobs
Create-SchedulerJob -Name "email-purchases" -Schedule "17 2 * * *" -Uri "$APP_URL/api/cron/email-purchases" -Description "Daily email purchase import (Vinted/eBay)"
Create-SchedulerJob -Name "vinted-collections" -Schedule "0 8 * * *" -Uri "$APP_URL/api/cron/vinted-collections" -Description "Daily Vinted parcel collection check"
Create-SchedulerJob -Name "retirement-sync" -Schedule "0 6 * * *" -Uri "$APP_URL/api/cron/retirement-sync" -Description "Daily retirement data sync from Brickset/BrickTap"
Create-SchedulerJob -Name "rebrickable-sync" -Schedule "0 4 * * 0" -Uri "$APP_URL/api/cron/rebrickable-sync" -Description "Weekly Rebrickable set data sync"
Create-SchedulerJob -Name "investment-sync" -Schedule "0 5 * * *" -Uri "$APP_URL/api/cron/investment-sync" -Description "Daily investment ASIN linkage and classification"
Create-SchedulerJob -Name "investment-retrain" -Schedule "0 6 1 * *" -Uri "$APP_URL/api/cron/investment-retrain" -Description "Monthly investment model retraining"

# Minifig sync jobs (eBay/Bricqer cross-listing)
Create-SchedulerJob -Name "minifig-daily-inventory" -Schedule "0 6 * * *" -Uri "$APP_URL/api/cron/minifigs/daily-inventory" -Description "Daily minifig inventory pull, Bricqer order poll, research refresh, repricing"
Create-SchedulerJob -Name "minifig-poll-ebay-orders" -Schedule "*/15 * * * *" -Uri "$APP_URL/api/cron/minifigs/poll-ebay-orders" -Description "Poll eBay for minifig sales (cross-platform delisting)"

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Created 15 Cloud Scheduler jobs:" -ForegroundColor White
gcloud scheduler jobs list --location=$REGION --format="table(name,schedule,state)"

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Test jobs manually: gcloud scheduler jobs run JOB_NAME --location=$REGION"
Write-Host "2. Monitor for 3-5 days alongside GitHub Actions"
Write-Host "3. Disable GitHub Actions workflows after validation"
Write-Host "4. Delete GitHub Actions workflow files"
Write-Host ""
Write-Host "To view logs: gcloud functions logs read pricing-sync-driver --gen2 --region=$REGION --limit=50"
