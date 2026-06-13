# Checklists

Checklists are defined in YAML files inside `backend/checklists/`. Each file is one checklist. The loader reads all `*.yaml` files in that directory at startup.

## YAML schema

```yaml
id: unique-kebab-case-id          # used in URL: /api/checklists/{id}
title: "Human Readable Title"
description: "Short subtitle shown in the list"
badge: "🏕️ Optional banner text shown at top of checklist"

sections:
  - id: section-id                 # unique within this file
    title: "Section Title"
    icon: "⛺"                     # any emoji
    optional: true                 # default false; shows "Optional" tag in header

    items:
      - id: item-id                # unique within this file (used as DB key)
        label: "Item display text"
        note: "Optional helper text shown below the label"
        tags:                      # all optional; controls colored badge display
          - rain                   # blue  — rain-specific gear
          - essential              # amber — must-have
          - optional               # purple — nice-to-have
          - new                    # green  — recently added
```

### Rules

- **`id` values must be unique across all items in a file.** The item `id` is the database primary key for check state. If you rename an `id`, all existing checks for that item are orphaned.
- All fields except `id` and `label` are optional.
- Tags are purely cosmetic — they show a colored badge but have no functional effect.
- The `optional` flag on a section adds a visual label; it doesn't hide items from the progress count.

## Adding a new checklist

1. Create `backend/checklists/my-checklist.yaml`
2. Restart the backend:
   ```bash
   # Docker (production / local Docker dev)
   docker compose restart backend

   # Local uvicorn dev — it auto-reloads on file change
   # (no action needed if using --reload)
   ```
3. Confirm it appears:
   ```bash
   curl http://localhost/api/checklists
   ```

## Minimal example

```yaml
id: day-hike
title: "Day Hike Checklist"
description: "Essentials for a single-day trail"

sections:
  - id: essentials
    title: "Essentials"
    icon: "🎒"
    items:
      - id: water
        label: "Water (2 L minimum)"
        tags: [essential]
      - id: snacks
        label: "Snacks"
      - id: map
        label: "Trail map or offline GPS"
        tags: [essential]
      - id: first-aid
        label: "First aid kit"
        tags: [essential]
      - id: rain-jacket
        label: "Rain jacket"
        tags: [rain]
```

## Editing existing checklists

- **Changing `label`, `note`, `tags`, `icon`, `title`:** safe at any time — no DB impact.
- **Changing an item `id`:** the old check records remain in the DB but are now orphaned (they'll never match). Run a migration if needed:
  ```sql
  UPDATE checks SET item_id = 'new-id' WHERE item_id = 'old-id';
  ```
- **Deleting an item:** its check records stay in the DB harmlessly (they're just never joined).
- **Reordering items or sections:** safe — order in YAML controls display order.
