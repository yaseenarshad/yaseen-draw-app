---
folder_page: true
folder_pages:
  - "[[Home]]"
folder_page_settings:
  columns:
    status:
      kind: select
      options:
        - 1-Backlog
        - 2-Todo
        - 3-In-Progress
        - 4-Done
    owner:
      kind: text
    due:
      kind: date
  folder: tasks
  defaultView: Table
  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
      order:
        - file.name
        - note.status
        - note.owner
        - note.due
      sort:
        - property: file.name
          direction: ASC
      groupBy:
        property: note.status
    - type: board
      name: Board
      groupBy:
        property: note.status
      order:
        - file.name
        - note.owner
        - note.status
---

# Tasks

Six members across three statuses, and one with none — the shape the `#` gutter, the header
menu, the drag and the column delete are proven over.
