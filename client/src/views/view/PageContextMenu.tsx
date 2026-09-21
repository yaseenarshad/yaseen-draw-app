import { api, BridgeRequestError } from '../../api'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { basename } from '../../lib/paths'

interface PageContextMenuProps {
  x: number
  y: number
  path: string
  onOpenRight?: (path: string) => void
  onOpenBackground?: (path: string) => void
  onNotice?: (message: string) => void
  onClose: () => void
}

/** Page actions shared by folder-page views; positioning and dismissal stay action-free. */
export function PageContextMenu({ x, y, path, onOpenRight, onOpenBackground, onNotice, onClose }: PageContextMenuProps) {
  const reveal = (): void => {
    onClose()
    api.reveal({ path }).catch((error: unknown) => {
      onNotice?.(
        error instanceof BridgeRequestError && error.code === 'NOT_FOUND'
          ? `Can't reveal "${basename(path)}" — it is no longer there`
          : `Can't reveal: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      {onOpenBackground !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpenBackground(path)
            onClose()
          }}
        >
          Open in new tab
        </button>
      )}
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard.writeText(path).catch((error: unknown) => {
            onNotice?.(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`)
          })
          onClose()
        }}
      >
        Copy path
      </button>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={reveal}>
        Reveal in Finder
      </button>
      {/* Last on purpose (YAZ-1556): the pane-specific open sits below the three page actions every surface shares. */}
      {onOpenRight !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpenRight(path)
            onClose()
          }}
        >
          Open in right panel
        </button>
      )}
    </ContextMenuSurface>
  )
}
