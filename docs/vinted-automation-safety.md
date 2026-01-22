# Vinted Scanner Automation Safety Guide

This document outlines the safety measures, ethical considerations, and operational guidelines for the automated Vinted LEGO arbitrage scanner.

## Purpose

This scanner is designed for **personal arbitrage hunting** - finding LEGO deals on Vinted that can be resold on Amazon. It operates within responsible automation limits to:

1. Find arbitrage opportunities for personal resale
2. Minimise impact on Vinted's platform
3. Respect rate limits and appear human-like
4. Avoid detection as automated scraping

## Safety Features

### 1. Rate Limiting

| Scan Type | Frequency | Pages | Daily Total |
|-----------|-----------|-------|-------------|
| Broad Sweep | Hourly | 1-3 pages | ~14 scans/day |
| Watchlist | 5-minute rotation | 1 page each | ~168 sets/day |

**Total daily page loads**: ~50-100 pages (comparable to an engaged human user)

### 2. Operating Hours

The scanner only operates during configurable hours (default 08:00-22:00):
- Mimics human browsing patterns
- Gives the system rest periods
- Reduces overall platform load

### 3. Randomised Timing

All operations include random delays:
- **Pre-scan delay**: 1-30 seconds
- **Between pages**: 3-10 seconds
- **Scroll delays**: 0.5-1.5 seconds
- **Filter toggles**: 10% probability, 1-2 seconds

### 4. CAPTCHA Detection & Auto-Pause

The scanner immediately stops if it detects:
- CAPTCHA URL patterns
- DataDome elements
- Challenge pages
- Security blocks

When detected:
1. Scanner auto-pauses
2. User receives Pushover notification
3. Manual CAPTCHA resolution required
4. User manually resumes when ready

### 5. Consecutive Failure Handling

After 3+ consecutive scan failures:
1. Warning notification sent
2. Failure count tracked
3. User can investigate and reset

## Ethical Considerations

### What This Is
- Personal deal-finding tool
- Manual purchase workflow (no auto-buying)
- Respects Vinted's ToS spirit (human browsing simulation)
- Single-user, personal use only

### What This Is NOT
- Mass scraping tool
- Commercial data harvesting
- Automated purchasing bot
- Multi-account operation

## Operational Guidelines

### Do's
✅ Keep operating hours reasonable (8-10 hour window)
✅ Use default timing delays or increase them
✅ Monitor CAPTCHA rate and pause if it exceeds 5%
✅ Manually complete any CAPTCHA challenges
✅ Review and action opportunities personally

### Don'ts
❌ Don't reduce timing delays below defaults
❌ Don't extend operating hours to 24/7
❌ Don't increase scan frequency
❌ Don't run multiple scanner instances
❌ Don't use VPNs or proxy rotation

## Configuration Recommendations

### Conservative (Recommended for New Users)
```
Broad sweep: Every 2 hours
Watchlist: 10-minute rotation
Operating hours: 09:00-20:00
COG threshold: 35%
```

### Standard (Default)
```
Broad sweep: Hourly
Watchlist: 5-minute rotation
Operating hours: 08:00-22:00
COG threshold: 40%
```

### Aggressive (Use with Caution)
```
Broad sweep: Hourly
Watchlist: 5-minute rotation
Operating hours: 07:00-23:00
COG threshold: 45%
```

## Monitoring & Maintenance

### Daily Checks
1. Review daily summary notification
2. Check for new opportunities
3. Verify no CAPTCHA warnings

### Weekly Checks
1. Review CAPTCHA detection rate
2. Check scan success rate
3. Verify watchlist effectiveness
4. Remove underperforming sets from watchlist

### Monthly Checks
1. Review overall opportunity quality
2. Assess if thresholds need adjustment
3. Consider rotating watchlist sets
4. Check for DOM selector updates if needed

## Troubleshooting

### High CAPTCHA Rate (>5%)
1. Increase timing delays by 50%
2. Reduce operating hours
3. Pause scanner for 24-48 hours
4. Consider scanning less frequently

### No Opportunities Found
1. Check if Vinted is accessible
2. Verify DOM selectors are current
3. Review COG threshold (may be too strict)
4. Check if watchlist is populated

### Consecutive Failures
1. Check scanner logs for error messages
2. Verify Chrome/Claude Code is working
3. Test manual Vinted access
4. Check for Vinted maintenance

## Data Retention

| Data Type | Retention Period |
|-----------|------------------|
| Active opportunities | Until actioned or 7 days |
| Dismissed opportunities | 14 days |
| Scan logs | 30 days |
| Watchlist stats | Indefinite (cumulative) |

## Emergency Stop

If you need to immediately stop all scanning:

### Via Dashboard
1. Navigate to `/arbitrage/vinted/automation`
2. Toggle the "Enabled" switch off

### Via PowerShell
```powershell
Disable-ScheduledTask -TaskName "Vinted-BroadSweep" -TaskPath "\Hadley Bricks\"
Disable-ScheduledTask -TaskName "Vinted-WatchlistRotation" -TaskPath "\Hadley Bricks\"
```

### Via Task Scheduler
1. Open Task Scheduler
2. Navigate to `\Hadley Bricks\`
3. Right-click tasks → Disable

## Legal Disclaimer

This tool is for personal use in finding arbitrage opportunities. Users are responsible for:

1. Complying with Vinted's Terms of Service
2. Operating within reasonable automation limits
3. Not using data for commercial purposes beyond personal resale
4. Ensuring all purchases are made manually and legitimately

The developers are not responsible for account actions taken by Vinted or any losses incurred from arbitrage activities.
