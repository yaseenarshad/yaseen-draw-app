import { shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BridgeFailure, requireAbsPath } from './fsUtils'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:'])

/** The one protocol allowlist shared by direct clicks and `_blank` popup interception. */
export const isExternalLinkProtocol = (protocol: string): boolean => EXTERNAL_PROTOCOLS.has(protocol)

export interface OpenLinkHost {
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<string>
}

interface OpenLinkRequestLike {
  href?: unknown
  sourcePath?: unknown
}

function requestOf(req: unknown): OpenLinkRequestLike {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    throw new BridgeFailure('BAD_REQUEST', 'invalid open-link request')
  }
  return req as OpenLinkRequestLike
}

function ioFailure(err: unknown, path?: string): BridgeFailure {
  return new BridgeFailure('IO_ERROR', err instanceof Error ? err.message : String(err), path === undefined ? {} : { path })
}

/** Opens one validated link target through the OS; the renderer never receives shell access. */
export async function openLink(req: unknown, host: OpenLinkHost = shell): Promise<void> {
  const input = requestOf(req)
  if (typeof input.href !== 'string' || input.href.trim() === '') throw new BridgeFailure('BAD_REQUEST', "missing 'href'")
  const href = input.href.trim()
  if (href.startsWith('#')) throw new BridgeFailure('BAD_REQUEST', 'fragment-only links stay inside the document')

  let target: URL
  try {
    target = new URL(href)
  } catch {
    if (input.sourcePath === undefined || input.sourcePath === '') {
      throw new BridgeFailure('BAD_REQUEST', "missing 'sourcePath' for a relative link")
    }
    const sourcePath = requireAbsPath(input.sourcePath, 'sourcePath')
    target = new URL(href, pathToFileURL(sourcePath))
  }

  if (isExternalLinkProtocol(target.protocol)) {
    try {
      // Hand the OS the same canonical URL whose protocol was validated above.
      await host.openExternal(target.href)
    } catch (err) {
      throw ioFailure(err)
    }
    return
  }

  if (target.protocol !== 'file:') throw new BridgeFailure('BAD_REQUEST', 'unsupported link protocol')
  target.hash = ''
  target.search = ''
  let path: string
  try {
    path = fileURLToPath(target)
  } catch {
    throw new BridgeFailure('BAD_REQUEST', 'invalid local file link')
  }
  try {
    const error = await host.openPath(path)
    if (error !== '') throw new Error(error)
  } catch (err) {
    throw ioFailure(err, path)
  }
}
