---
folder_page: true
folder_pages:
  - "[[Home]]"
folder_page_settings:
  columns:
    owner:
      kind: text
  folder: legacy
  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
      order:
        - file.name
        - note.owner
    - type: board
      name: Board
---

# Legacy

A folder page born BEFORE YAZ-1513: no `status` declaration. `tools/seedDefaultColumns.mjs`
gives it one — and appends `note.status` to the Table's order — on `--apply` only.
