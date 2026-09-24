/** The draw.io webapp's own origin: main's `app://` scheme, `drawio` host, apart from the renderer's (🔒 YAZ-1802 D4). */
export const DRAWIO_HOST = 'drawio'
export const DRAWIO_ORIGIN = `app://${DRAWIO_HOST}`

/** 🔒 YAZ-1802 D5: the pinned draw.io release. Keep in step with `DRAWIO_TAG` in `tools/packDrawio.mjs` (`packDrawio.test.mjs` pins the pair). */
export const DRAWIO_TAG = 'v31.5.2'
