import { describe, expect, it } from 'vitest'
import { canRenameWithoutConversion, fileKind, isBoard, isDiagram, isDrawing } from './fileKind'

/** The one classifier (docs/CONTRACTS.md "Supported file capabilities"), with draw.io beside Excalidraw (🔒 YAZ-1802 D2). */
describe('fileKind', () => {
  it('classifies an Excalidraw scene as a drawing and a .drawio as a diagram, case-insensitively', () => {
    expect(fileKind('/v/Board.excalidraw')).toBe('drawing')
    expect(fileKind('/v/Board.EXCALIDRAW')).toBe('drawing')
    expect(fileKind('/v/Flow.drawio')).toBe('diagram')
    expect(fileKind('/v/UPPERCASE.DRAWIO')).toBe('diagram')
    expect(fileKind('Mixed.DrawIO')).toBe('diagram')
  })

  it('a picture with a diagram inside is NOT a diagram (D3: `.drawio` only)', () => {
    expect(fileKind('/v/image.drawio.svg')).toBeNull()
    expect(fileKind('/v/image.drawio.png')).toBeNull()
    expect(fileKind('/v/export.drawio.xml')).toBeNull()
  })

  it('no extension, a dotfile, and other files are of no kind', () => {
    for (const name of ['README', '.drawio', '.excalidraw', 'notes.md', 'x.xml', '/v/dir.drawio/inner.txt']) expect(fileKind(name), name).toBeNull()
  })

  it('isDrawing stays Excalidraw-only, isDiagram is draw.io-only, isBoard is either', () => {
    expect([isDrawing('a.excalidraw'), isDrawing('a.drawio')]).toEqual([true, false])
    expect([isDiagram('a.excalidraw'), isDiagram('a.drawio')]).toEqual([false, true])
    expect([isBoard('a.excalidraw'), isBoard('a.drawio'), isBoard('a.drawio.svg')]).toEqual([true, true, false])
    expect([isBoard('A.DRAWIO'), isBoard('A.EXCALIDRAW'), isBoard('x.svg')]).toEqual([true, true, false])
  })

  it('a rename never converts between the two kinds (🔒 YAZ-1802 D13)', () => {
    expect(canRenameWithoutConversion('a.drawio', 'b.drawio')).toBe(true)
    expect(canRenameWithoutConversion('a.drawio', 'b.DRAWIO')).toBe(true)
    expect(canRenameWithoutConversion('a.drawio', 'a.excalidraw')).toBe(false)
    expect(canRenameWithoutConversion('a.excalidraw', 'a.drawio')).toBe(false)
    expect(canRenameWithoutConversion('a.drawio', 'a.drawio.svg')).toBe(false)
  })
})
