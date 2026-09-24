import { describe, expect, it } from 'vitest'
import { BOARD_META_HEAD_BYTES } from './drawingAssets'
import { DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR, EMPTY_DIAGRAM_XML, diagramDocumentError, diagramRoot, parseDiagramMetaAttrs, stampDiagramMeta } from './diagramFile'

const PAGE = '<diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram>'
const file = (attrs = '') => `<mxfile${attrs}>${PAGE}</mxfile>\n`

describe('diagramRoot / diagramDocumentError (🔒 YAZ-1802 D6)', () => {
  it('knows the two roots draw.io writes, past a BOM, a declaration, comments and whitespace', () => {
    expect(diagramRoot(file())).toBe('mxfile')
    expect(diagramRoot('﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- hi -->\n<mxfile host="x">…')).toBe('mxfile')
    expect(diagramRoot('<mxGraphModel dx="1"><root/></mxGraphModel>')).toBe('mxGraphModel')
    expect(diagramRoot('<mxfilesystem/>')).toBeNull()
    expect(diagramRoot('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull()
    expect(diagramRoot('{ "type": "excalidraw" }')).toBeNull()
  })

  it('accepts whole documents, compressed pages included', () => {
    expect(diagramDocumentError(file())).toBeNull()
    expect(diagramDocumentError('<mxfile><diagram id="a" name="P">7ZfBbqMwEIafhmPEFmQqPAAAA</diagram></mxfile>')).toBeNull()
    expect(diagramDocumentError('<mxGraphModel><root/></mxGraphModel>')).toBeNull()
    expect(diagramDocumentError('<mxfile/>')).toBeNull()
    expect(diagramDocumentError(EMPTY_DIAGRAM_XML)).toBeNull()
  })

  it('names what is wrong with an empty, non-XML, foreign-XML or cut-short file', () => {
    expect(diagramDocumentError('')).toMatch(/empty/)
    expect(diagramDocumentError('  \n')).toMatch(/empty/)
    expect(diagramDocumentError('this is not xml at all')).toMatch(/not a draw.io diagram/)
    expect(diagramDocumentError('<note><to>Tove</to></note>')).toMatch(/not a draw.io diagram/)
    expect(diagramDocumentError('<mxfile><diagram id="a">')).toMatch(/cut short/)
    expect(diagramDocumentError('<mxfile><diagram id="a"><!-- half -->')).toMatch(/cut short/)
  })

  it('a comment, processing instruction or whitespace AFTER the root is still a whole document', () => {
    expect(diagramDocumentError(`${file()}<!-- exported by some tool -->\n`)).toBeNull()
    expect(diagramDocumentError('<mxfile/>\n<?tool done?>\n<!-- a --> \n')).toBeNull()
  })
})

describe('parseDiagramMetaAttrs (🔒 YAZ-1802 D7)', () => {
  it('reads both dates off the root <mxfile>, epoch ms like the Excalidraw block', () => {
    expect(parseDiagramMetaAttrs(file(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000" host="x"`))).toEqual({ createdAt: 1000, updatedAt: 2000 })
  })

  it('works on a head cut mid-document, as the tree reads it', () => {
    const head = file(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000"`).slice(0, 80)
    expect(parseDiagramMetaAttrs(head)).toEqual({ createdAt: 1000, updatedAt: 2000 })
  })

  it('is null — "no metadata" — for a missing, half or malformed pair, or another root', () => {
    expect(parseDiagramMetaAttrs(file())).toBeNull()
    expect(parseDiagramMetaAttrs(file(` ${DIAGRAM_CREATED_ATTR}="1000"`))).toBeNull()
    expect(parseDiagramMetaAttrs(file(` ${DIAGRAM_CREATED_ATTR}="soon" ${DIAGRAM_UPDATED_ATTR}="2000"`))).toBeNull()
    expect(parseDiagramMetaAttrs(`<mxGraphModel ${DIAGRAM_CREATED_ATTR}="1" ${DIAGRAM_UPDATED_ATTR}="2"/>`)).toBeNull()
    // Only the ROOT tag counts, never an attribute further down.
    expect(parseDiagramMetaAttrs(`<mxfile><diagram ${DIAGRAM_CREATED_ATTR}="1" ${DIAGRAM_UPDATED_ATTR}="2"/></mxfile>`)).toBeNull()
  })
})

describe('stampDiagramMeta (🔒 YAZ-1802 D7)', () => {
  const at = { createdAt: 5000, updatedAt: 6000 }

  it('puts both dates FIRST in the root tag and leaves every other byte alone', () => {
    const out = stampDiagramMeta(file(' host="x" version="31"'), at)
    expect(out).toBe(`<mxfile ${DIAGRAM_CREATED_ATTR}="5000" ${DIAGRAM_UPDATED_ATTR}="6000" host="x" version="31">${PAGE}</mxfile>\n`)
    expect(parseDiagramMetaAttrs(out.slice(0, BOARD_META_HEAD_BYTES))).toEqual({ createdAt: 5000, updatedAt: 6000 })
  })

  it('both dates fit the head the tree reads, however many attributes draw.io writes after them', () => {
    const agent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) draw.io-embed ${'x'.repeat(600)}`
    const drawio = file(` host="Electron" agent="${agent}" modified="2026-09-24T08:00:00.000Z" version="31.5.2" etag="abc123" type="device" pages="3" compressed="false" scale="1" border="0" userAgent="${agent}"`)
    const out = stampDiagramMeta(drawio, at)
    expect(out.indexOf('>')).toBeGreaterThan(BOARD_META_HEAD_BYTES)
    expect(parseDiagramMetaAttrs(out.slice(0, BOARD_META_HEAD_BYTES))).toEqual({ createdAt: 5000, updatedAt: 6000 })
  })

  it('keeps the created date the FILE had (prior), else the one inside the XML, and always moves updated', () => {
    expect(parseDiagramMetaAttrs(stampDiagramMeta(file(), at, { createdAt: 1, updatedAt: 2 }))).toEqual({ createdAt: 1, updatedAt: 6000 })
    const own = file(` ${DIAGRAM_CREATED_ATTR}="7" ${DIAGRAM_UPDATED_ATTR}="8"`)
    expect(parseDiagramMetaAttrs(stampDiagramMeta(own, at))).toEqual({ createdAt: 7, updatedAt: 6000 })
  })

  it('replaces stale attributes instead of doubling them, and is byte-stable when stamped twice', () => {
    const once = stampDiagramMeta(file(' host="x"'), at)
    const twice = stampDiagramMeta(once, at, parseDiagramMetaAttrs(once))
    expect(twice).toBe(once)
    expect(twice.match(new RegExp(DIAGRAM_CREATED_ATTR, 'g'))).toHaveLength(1)
  })

  it('stamps a self-closing <mxfile/> and leaves a bare <mxGraphModel> untouched', () => {
    expect(stampDiagramMeta('<mxfile/>', at)).toBe(`<mxfile ${DIAGRAM_CREATED_ATTR}="5000" ${DIAGRAM_UPDATED_ATTR}="6000"/>`)
    const bare = '<mxGraphModel><root/></mxGraphModel>'
    expect(stampDiagramMeta(bare, at)).toBe(bare)
  })

  it('the empty diagram is born with page view, grid and guides off (D12a) and stamps cleanly', () => {
    expect(EMPTY_DIAGRAM_XML).toContain('page="0"')
    expect(EMPTY_DIAGRAM_XML).toContain('grid="0"')
    expect(EMPTY_DIAGRAM_XML).toContain('guides="0"')
    expect(diagramDocumentError(stampDiagramMeta(EMPTY_DIAGRAM_XML, at))).toBeNull()
  })
})
