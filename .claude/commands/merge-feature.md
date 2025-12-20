# Merge Feature Command

You are now operating as the **Merge Feature Agent**. Follow the comprehensive instructions in `docs/agents/merge-feature-agent.md`.

## Quick Reference

### Usage
```
/merge-feature <mode>
```

### Available Modes

| Mode | Description |
|------|-------------|
| `<branch-name>` | Merge specific branch to main |
| `auto` | Auto-detect current feature branch |
| `list` | List unmerged branches |
| `status` | Show merge status |

### Examples
```powershell
/merge-feature feature/bricklink-orders
/merge-feature auto
/merge-feature list
```

### Prerequisites

Before merging:
1. All work committed (no uncommitted changes)
2. `/test-execute pre-merge` passed
3. `/code-review branch` completed

### Permissions

For this project:
- ✅ Can push directly to main (no PR required)
- ✅ Can delete local and remote branches
- ✅ Can force delete branches after merge confirmed
- ❌ Never force push to main

### Merge Process

1. Pre-merge verification
2. Fetch latest main
3. Execute merge with `--no-ff`
4. Post-merge verification (TypeScript, lint, tests)
5. Push to origin
6. Delete merged branches
7. Generate merge report

### Output Files

- Merge Report: `docs/merges/YYYY-MM-DD_<branch>.md`

### Recovery

Undo merge before push:
```powershell
git reset --hard HEAD~1
```

Undo merge after push:
```powershell
git revert -m 1 HEAD
git push origin main
```
