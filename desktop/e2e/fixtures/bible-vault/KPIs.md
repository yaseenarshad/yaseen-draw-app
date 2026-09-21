---
folder_page: true
folder_pages:
  - "[[Home]]"
folder_page_settings:
  columns:
    funnel_stages:
      kind: multi-link
      target: "[[Funnel Stages]]"
    kpi_category:
      kind: text
    unit:
      kind: text
  folder: kpis
  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
      order:
        - file.name
        - note.kpi_category
        - note.unit
        - note.funnel_stages
    - type: board
      name: Board
---

# KPIs

The numbers the funnel is judged on. Each one names the stages it belongs to, so the same
metric can be owned jointly without anybody maintaining a second list.
