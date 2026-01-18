# Listing Templates

## Overview

Templates are reusable HTML structures that the AI uses as a foundation for generating listings. They contain placeholders that get filled in with set-specific information during generation.

## Accessing Templates

**Navigation**: Dashboard sidebar → Listing Assistant → Templates tab

## Template Gallery

The Templates tab displays all your templates as cards showing:
- Template name
- Type badge (LEGO New, LEGO Used, Custom)
- Default badge (if set as default)
- Content preview (first ~300 characters)

## Creating a Template

1. Click **New Template** button
2. Fill in the form:
   - **Template Name**: Descriptive name (e.g., "Used LEGO Sets")
   - **Type**: Select category
   - **Template Content**: HTML with placeholders
3. Click **Save Template**

### Template Types

| Type | Code | Auto-selected When |
|------|------|-------------------|
| LEGO New | `lego_new` | Condition = New |
| LEGO Used | `lego_used` | Condition = Used |
| Custom | `custom` | Manual selection |

## Editing a Template

1. Click **Edit** button on template card
2. Modify fields in the dialog
3. Click **Save Template**

The rich text editor allows:
- Visual editing with formatting toolbar
- Direct HTML editing
- Live preview

## Deleting a Template

1. Click the trash icon on template card
2. Confirm deletion in dialog
3. Template is permanently removed

**Note**: Default templates cannot be deleted.

## Placeholders

Use these placeholders in your templates. The AI replaces them with actual values:

| Placeholder | Replaced With |
|-------------|---------------|
| `[Set Number]` | LEGO set number (e.g., 75192) |
| `[Set Name]` | Official set name |
| `[Theme]` | LEGO theme (Star Wars, Technic, etc.) |
| `[Year]` | Release year |
| `[Piece Count]` | Number of pieces |
| `[Minifigures]` | Minifigure count |
| `[Retail Price]` | Original retail price |
| `[Description]` | AI-generated description |
| `[Condition Notes]` | From key points input |
| `[Includes]` | What's included |

## Example Template

```html
<div style="font-family: Arial, sans-serif;">
  <h1 style="color: #1a1a1a;">LEGO [Set Number] - [Set Name]</h1>

  <div style="background: #f5f5f5; padding: 15px; margin: 10px 0;">
    <strong>Theme:</strong> [Theme]<br>
    <strong>Year:</strong> [Year]<br>
    <strong>Pieces:</strong> [Piece Count]<br>
    <strong>Minifigures:</strong> [Minifigures]
  </div>

  <h2>About This Set</h2>
  <p>[Description]</p>

  <h2>What's Included</h2>
  <p>[Includes]</p>

  <h2>Condition</h2>
  <p>[Condition Notes]</p>

  <div style="border-top: 1px solid #ddd; padding-top: 10px; margin-top: 20px;">
    <p><em>Thank you for looking! Please check my other listings.</em></p>
  </div>
</div>
```

## Best Practices

### Structure

- Use semantic HTML (`<h1>`, `<h2>`, `<p>`)
- Include clear sections
- Add visual hierarchy

### Styling

- Use inline styles (eBay requirement)
- Keep colors readable
- Mobile-friendly widths
- Avoid external CSS

### Content

- Include key information upfront
- Add trust-building elements
- Clear calls to action
- Professional formatting

### Placeholders

- Use all relevant placeholders
- Provide fallback text for optional fields
- Test with different set types

## Default Templates

The system includes built-in default templates:
- Cannot be deleted
- Can be edited
- Marked with "Default" badge
- Auto-selected based on condition

## Template Selection

When generating a listing:
1. System checks item condition
2. Finds matching template type
3. Falls back to first available template
4. User can override selection

## Technical Details

### Database Schema

```sql
CREATE TABLE listing_templates (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/listing-assistant/templates` | GET | List all templates |
| `/api/listing-assistant/templates` | POST | Create template |
| `/api/listing-assistant/templates/[id]` | PUT | Update template |
| `/api/listing-assistant/templates/[id]` | DELETE | Delete template |

## Troubleshooting

### Template not appearing
- Refresh the page
- Check for API errors in console
- Verify you have permission

### Formatting issues
- Use inline styles only
- Test in eBay preview
- Avoid complex CSS

### Placeholders not replaced
- Check placeholder spelling exactly
- Include square brackets
- Case sensitive

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/features/listing-assistant/tabs/TemplatesTab.tsx` | Templates UI |
| `apps/web/src/hooks/listing-assistant/use-templates.ts` | Template hooks |
| `apps/web/src/lib/listing-assistant/constants.ts` | Template type definitions |
