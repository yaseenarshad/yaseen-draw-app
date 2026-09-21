// The preload installs the bridge (Desktop A1, GRO-2153). Lives here, not in shared/, because
// the desktop (main/preload) tsconfig has no DOM lib and `Window` would not resolve there.
import type { YaseenDocsApi } from '@shared/types'

declare global {
  interface Window {
    yaseenDocs: YaseenDocsApi
  }
}

export {}
