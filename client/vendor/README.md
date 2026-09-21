# Vendored drawing engine (yaseendraw)

The five `yaseendraw-*-<forkCommit>.tgz` tarballs are the `@excalidraw/excalidraw` package
and its four monorepo siblings (`common`, `element`, `math`, `fractional-indexing`), built
from Yasin's fork (github.com/yaseenarshad/yaseen-excalidraw) at the commit named in every
filename. Milkdown consumes them via the `file:` dependencies in `client/package.json`
(YAZ-868: rulings D1/D2 — consume the fork build as-is, pinned tarballs in-repo).

Why five and not one: the fork's package build externalizes its siblings as real runtime
imports, and those don't exist on npm at the fork's versions — so the siblings ship too
(they're tiny; the main tarball's ~31 MB is mostly fonts plus the dev build the exports
map requires).

## Sync a fork change into milkdown

```bash
cd ~/Documents/GitHub/yaseen-excalidraw && git pull
yarn install
HASH=$(git rev-parse --short HEAD)
V=~/Documents/GitHub/yaseen-milkdown/client/vendor
for p in excalidraw common element math fractional-indexing; do
  yarn --cwd ./packages/$p build:esm
  (cd packages/$p && npm pack --pack-destination /tmp)
  ver=$(node -p "require('./packages/$p/package.json').version")
  mv /tmp/excalidraw-$p-$ver.tgz $V/yaseendraw-$p-$ver-$HASH.tgz
done
```

Then in milkdown: delete the old tarballs, point the five `file:` entries in
`client/package.json` at the new filenames, run `npm install`, build, run the e2e drawing
specs, commit all of it together. The fork hash in the filenames is deliberate — it pins
provenance and busts npm's `file:` tarball cache on every bump.
