/** Exercise the pinned dependency's shipped geometry, not a copy of its implementation. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const runtime = readFileSync(resolve(__dirname, '../../../node_modules/@milkdown/components/lib/table-block/index.js'), 'utf8')
const parsed = ts.createSourceFile('table-block.js', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = parsed.statements.filter(ts.isFunctionDeclaration)
  .filter(node => node.name?.text !== 'findPointerIndex').map(node => node.getText(parsed)).join('\n')
const computePosition = vi.fn(async () => ({ x: 33, y: 44 }))
const offset = vi.fn((value: number) => value)
// Vue/ProseMirror are outside these geometry functions. Preserve actual DOM/drop-index logic;
// stub only Floating UI's already-local result, throttle timing, and pointer-to-cell lookup.
const geometry = new Function('computePosition', 'offset', 'throttle', 'findPointerIndex',
  `${functions}; return { renderPreview, createDragOverHandler, createPointerMoveHandler };`
)(computePosition, offset, (fn: unknown) => fn, () => [1, 0])

function box(element: Element, zoom: number, x: number, y: number, width: number, height: number) {
  Object.defineProperty(element, 'currentCSSZoom', { value: zoom, configurable: true })
  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true })
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 300 + x * zoom, left: 300 + x * zoom, y: 200 + y * zoom, top: 200 + y * zoom,
    width: width * zoom, height: height * zoom, right: 300 + (x + width) * zoom,
    bottom: 200 + (y + height) * zoom, toJSON: () => ({}),
  })
}
function fixture(zoom: number) {
  const wrapper = document.createElement('div')
  const content = document.createElement('table')
  content.innerHTML = '<tbody><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></tbody>'
  const tbody = content.querySelector('tbody')!
  wrapper.append(content)
  box(wrapper, zoom, 0, 0, 300, 90)
  box(content, zoom, 0, 0, 300, 90)
  box(tbody, zoom, 0, 0, 300, 90)
  Object.defineProperty(wrapper, 'offsetLeft', { value: 10 })
  Object.defineProperty(wrapper, 'offsetTop', { value: 20 })
  Object.defineProperty(tbody, 'offsetParent', { value: wrapper })
  Array.from(content.rows).forEach((row, i) => {
    box(row, zoom, 0, i * 30, 300, 30)
    Array.from(row.cells).forEach((cell, j) => box(cell, zoom, j * 150, i * 30, 150, 30))
  })
  const preview = document.createElement('div')
  preview.innerHTML = '<table><tbody></tbody></table>'
  box(preview, zoom, 0, 0, 300, 30)
  const yHandle = document.createElement('div'), xHandle = document.createElement('div')
  box(yHandle, zoom, 0, 0, 4, 90)
  box(xHandle, zoom, 0, 0, 300, 4)
  const refs = {
    dragPreviewRef: { value: preview }, tableWrapperRef: { value: wrapper }, contentWrapperRef: { value: content },
    yLineHandleRef: { value: yHandle }, xLineHandleRef: { value: xHandle },
    colHandleRef: { value: document.createElement('div') }, rowHandleRef: { value: document.createElement('div') },
    hoverIndex: { value: [1, 0] }, lineHoverIndex: { value: [-1, -1] },
    dragInfo: { value: { type: 'col', startCoords: [300 + 50 * zoom, 200 + 45 * zoom], startIndex: 0, endIndex: 0 } },
  }
  computePosition.mockClear(); offset.mockClear()
  return { content, preview, refs, yHandle, xHandle }
}

describe.each([0.5, 1, 1.25, 2])('shipped Milkdown table geometry at zoom %s', zoom => {
  it.each(['x', 'y'])('sizes the %s drag preview in document pixels', axis => {
    const { content, preview } = fixture(zoom)
    geometry.renderPreview(axis, preview, preview.querySelector('tbody'), content, 1)
    expect(preview.style.width).toBe(axis === 'x' ? '150px' : '300px')
    expect(preview.style.height).toBe(axis === 'x' ? '90px' : '30px')
    expect(preview.querySelectorAll('td').length).toBe(2)
  })
  it('positions a column preview locally while choosing the actual viewport drop column', async () => {
    const { refs, preview, yHandle } = fixture(zoom)
    const drag = geometry.createDragOverHandler(refs)
    drag({ clientX: 300 + 225 * zoom, clientY: 200 + 45 * zoom })
    await Promise.resolve()
    expect(preview.style.left).toBe('160px')
    expect(preview.style.top).toBe('20px')
    expect(refs.dragInfo.value.endIndex).toBe(1)
    expect(yHandle.style.height).toBe('90px')
    expect(yHandle.style.left).toBe('33px')
    drag({ clientX: 300 - 500 * zoom, clientY: 200 + 45 * zoom })
    await Promise.resolve()
    expect(preview.style.left).toBe('-10px')
    expect(refs.dragInfo.value.endIndex).toBe(0)
    expect(offset).toHaveBeenLastCalledWith(-4)
  })
  it('positions a row preview locally and clamps it without changing row targeting', async () => {
    const { refs, preview, xHandle } = fixture(zoom)
    refs.dragInfo.value.type = 'row'
    const drag = geometry.createDragOverHandler(refs)
    drag({ clientX: 300 + 75 * zoom, clientY: 200 + 80 * zoom })
    await Promise.resolve()
    expect(preview.style.top).toBe('85px')
    expect(preview.style.left).toBe('10px')
    expect(refs.dragInfo.value.endIndex).toBe(2)
    expect(xHandle.style.width).toBe('300px')
    expect(xHandle.style.top).toBe('44px')
    drag({ clientX: 300 + 75 * zoom, clientY: 200 - 500 * zoom })
    await Promise.resolve()
    expect(preview.style.top).toBe('0px')
    expect(refs.dragInfo.value.endIndex).toBe(0)
    expect(offset).toHaveBeenLastCalledWith(-4)
  })
  it('sizes insertion lines and offsets in layout pixels', async () => {
    const { refs, yHandle, xHandle } = fixture(zoom)
    const pointer = geometry.createPointerMoveHandler(refs, { editable: true })
    pointer({ clientX: 300 + zoom, clientY: 200 + 45 * zoom })
    await Promise.resolve()
    expect(yHandle.style.height).toBe('90px')
    expect(offset).toHaveBeenLastCalledWith(-4)
    pointer({ clientX: 300 + 75 * zoom, clientY: 200 + 31 * zoom })
    await Promise.resolve()
    expect(xHandle.style.width).toBe('300px')
    expect(offset).toHaveBeenLastCalledWith(-4)
  })
})
