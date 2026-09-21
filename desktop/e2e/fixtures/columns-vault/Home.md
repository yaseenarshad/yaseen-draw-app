---
folder_page: true
folder_page_settings:
  columns:
    status:
      kind: select
      options:
        - 1-Backlog
        - 2-Todo
        - 3-In-Progress
        - 4-Done
  views:
    - type: outline
      name: Outline
      order:
        - "[[Tasks]]"
        - "[[Legacy]]"
    - type: table
      name: Table
    - type: board
      name: Board
---

# Home

The root of this small vault: two folder pages, one born after YAZ-1513 (`Tasks`, with the
`status` column) and one born before it (`Legacy`, without), plus one ordinary note (`Plain`).
