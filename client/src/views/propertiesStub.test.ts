/**
 * In-memory `PropertiesApi` stub (YAZ-835): `get` on an untouched root resolves empty — never an
 * error — and never creates state; mutations are targeted and fire every `onChange` listener with
 * a fresh snapshot. `version` is the constant 1, matching the real `.yaseendocs/properties.json`
 * bridge this stub stands in for (GRO-2204 alignment).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { propertiesStub, resetPropertiesStub } from './propertiesStub'

afterEach(() => resetPropertiesStub())

describe('get', () => {
  it('an untouched root resolves { properties: {} } — empty, not an error', async () => {
    await expect(propertiesStub.get('/vault')).resolves.toEqual({ root: '/vault', version: 1, properties: {} })
  })

  it('roots are independent', async () => {
    await propertiesStub.setProperty('/a', 'x', { kind: 'text' })
    expect((await propertiesStub.get('/b')).properties).toEqual({})
    expect((await propertiesStub.get('/a')).properties.x).toEqual({ kind: 'text' })
  })

  it('returns a snapshot: mutating the result never corrupts the store', async () => {
    await propertiesStub.setProperty('/vault', 'x', { kind: 'text' })
    const res = await propertiesStub.get('/vault')
    res.properties.x.kind = 'number'
    expect((await propertiesStub.get('/vault')).properties.x.kind).toBe('text')
  })
})

describe('setProperty', () => {
  it("stores the declaration under properties; version stays the bridge's constant 1", async () => {
    await propertiesStub.setProperty('/vault', 'owner', { kind: 'link', target: 'person' })
    const res = await propertiesStub.get('/vault')
    expect(res.properties.owner).toEqual({ kind: 'link', target: 'person' })
    expect(res.version).toBe(1)
  })

  it('a second write to the same key replaces the declaration', async () => {
    await propertiesStub.setProperty('/vault', 'x', { kind: 'link', target: 'a' })
    await propertiesStub.setProperty('/vault', 'x', { kind: 'multi-link', target: 'b' })
    const res = await propertiesStub.get('/vault')
    expect(res.properties.x).toEqual({ kind: 'multi-link', target: 'b' })
    expect(res.version).toBe(1)
  })
})

describe('removeProperty', () => {
  it('deletes the named key only; an unknown key is a no-op', async () => {
    await propertiesStub.setProperty('/vault', 'x', { kind: 'text' })
    await propertiesStub.setProperty('/vault', 'y', { kind: 'number' })
    await propertiesStub.removeProperty('/vault', 'x')
    await propertiesStub.removeProperty('/vault', 'ghost')
    const res = await propertiesStub.get('/vault')
    expect(res.properties.x).toBeUndefined()
    expect(res.properties.y).toEqual({ kind: 'number' })
  })
})

describe('onChange', () => {
  it('fires each listener with the new snapshot after every mutation', async () => {
    const seen = vi.fn()
    propertiesStub.onChange(seen)
    await propertiesStub.setProperty('/vault', 'x', { kind: 'text' })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0]).toEqual({ root: '/vault', version: 1, properties: { x: { kind: 'text' } } })
  })

  it('the returned unsubscribe stops delivery', async () => {
    const seen = vi.fn()
    const unsubscribe = propertiesStub.onChange(seen)
    unsubscribe()
    await propertiesStub.setProperty('/vault', 'x', { kind: 'text' })
    expect(seen).not.toHaveBeenCalled()
  })
})
