---
folder_page: true
folder_page_settings:
  columns:
    dept:
      kind: text
    proc:
      kind: text
    owner:
      kind: text
    trigger:
      kind: text
    system:
      kind: text
    cadence:
      kind: text
    status:
      kind: text
  folder: automations
  views:
    - type: table
      name: Dept then process
      order:
        - file.name
        - note.dept
        - note.proc
        - note.owner
        - note.trigger
        - note.system
        - note.cadence
        - note.status
      sort:
        - property: file.name
          direction: ASC
      groupBy:
        - property: note.dept
        - property: note.proc
    - type: table
      name: Dept only
      order:
        - file.name
        - note.dept
        - note.proc
        - note.owner
        - note.trigger
        - note.system
        - note.cadence
        - note.status
      sort:
        - property: file.name
          direction: ASC
      groupBy:
        - property: note.dept
    - type: board
      name: Board
      order:
        - file.name
        - note.owner
        - note.status
      sort:
        - property: file.name
          direction: ASC
      groupBy:
        - property: note.dept
        - property: note.proc
---
