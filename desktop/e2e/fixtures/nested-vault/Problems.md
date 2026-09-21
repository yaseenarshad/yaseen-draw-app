---
folder_page: true
folder_page_settings:
  columns:
    function:
      kind: link
  folder: problems
  formulas:
    function_top: "if(function.asFile().properties.parent, function.asFile().properties.parent, function)"
  views:
    - type: table
      name: By function
      order:
        - file.name
        - note.function
      sort:
        - property: file.name
          direction: ASC
      groupBy:
        - property: formula.function_top
        - property: note.function
    - type: board
      name: Board
---
