# Milkdown components CSS zoom patch

`milkdown-components-7.22.1-yaz1410.tgz` is a version-pinned build of
`@milkdown/components@7.22.1`. It corrects table drag preview, drag-over, and
boundary indicator geometry when the editor is inside a CSS `zoom` context.
The package name and version remain unchanged so every Milkdown package uses
the same 7.22.1 dependency graph.

When updating an existing checkout, use `npm ci` to install the locked archive.
Because the package version is unchanged, `npm install` can retain an already
installed upstream copy. `client/src/editor/tableZoom.test.ts` checks the actual
installed runtime and catches that stale installation.

The upstream package is MIT licensed and includes its original `LICENSE` file.
Source: <https://registry.npmjs.org/@milkdown/components/-/components-7.22.1.tgz>
Upstream npm integrity:
`sha512-6IA8fcFcBTm/x1X1typz73yUoT1JuN4srmifGAIeWEtCnayEwRjFxpQOoQrfvMgBYx4DSHcPVLhJUlR/xbBtxg==`.

Rebuild from the pinned registry artifact:

```sh
node tools/buildMilkdownComponentsPatch.mjs
```

For an offline rebuild, pass the unmodified upstream npm archive:

```sh
node tools/buildMilkdownComponentsPatch.mjs --source /path/to/components-7.22.1.tgz
```

The build verifies the entire upstream archive against its pinned integrity, then
applies the adjacent readable `.patch` with Git. It fails if the source has drifted.
Use `--output /path/to/rebuilt.tgz` to compare a rebuild without replacing the vendor archive.
Only these files differ from upstream:

- `src/table-block/dnd/preview.ts`
- `src/table-block/dnd/drag-over-handler.ts`
- `src/table-block/view/pointer.ts`
- `lib/table-block/index.js`

The stale table-block source map and its `sourceMappingURL` are removed because
the compiled runtime is patched directly. No exports or declarations change.
