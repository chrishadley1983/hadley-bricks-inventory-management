# {Journey Name}

## Overview

{One paragraph describing this user journey}

## Entry Points

- {Entry point 1 — e.g., Dashboard → "Add Item" button}
- {Entry point 2 — e.g., Navigation → Inventory → Add}

## Flow

### Step 1: {Step Name}

{Description of this step}

![{Screenshot alt}](../screenshots/{feature}/{screenshot}.png)

**Fields/Elements:**

| Element | Type | Description | Validation |
|---------|------|-------------|------------|
| {Element} | {Type} | {Description} | {Rules} |

### Step 2: {Step Name}

{Description}

{Continue for all steps...}

## Business Logic

### {Logic Name}

**Plain English:**
{Human-readable explanation of what the logic does and why}

**Formula/Rules:**
```
{formula or pseudo-code}
```

**Example:**
{Concrete example with numbers}

**Edge Cases:**
- {Edge case 1 and how it's handled}
- {Edge case 2 and how it's handled}

**Source:** `{file path}:{function}()`

## Error Handling

| Error | Cause | User Sees | Resolution |
|-------|-------|-----------|------------|
| {Error message} | {What triggers it} | {UI feedback} | {How to fix} |

## States

| State | Condition | Screenshot |
|-------|-----------|------------|
| Empty | No data exists | ![Empty state](../screenshots/{feature}/{page}-empty.png) |
| Loading | Data fetching | Skeleton placeholder |
| Error | API failure | Error message with retry |
| Success | Data loaded | ![Success state](../screenshots/{feature}/{page}-success.png) |

## Permissions

| Action | Required Permission |
|--------|---------------------|
| {Action} | {Permission/Role} |

## Related

- [{Related journey}](./{related}.md)
- [{Parent feature}](./overview.md)

---

*Generated: {timestamp}*
*Sources: {file list}*
*Screenshots: {count}*
