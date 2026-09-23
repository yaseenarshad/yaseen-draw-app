/** Vite's `?raw` import: the file's text, bundled into main (the share Worker's sources, YAZ-1799). */
declare module '*?raw' {
  const source: string
  export default source
}
