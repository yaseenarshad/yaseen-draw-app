import type { TreeResponse } from '@shared/types'
import { ASSETS_DIR } from '@shared/drawingAssets'
import { buildTree, fsCall, requireAbsPath, requireDir } from './fsUtils'

/**
 * `window.yaseenDraw.tree(root)`: recursive vault tree of `root` (see `buildTree`).
 *
 * The TOP-LEVEL `assets/` folder is hidden (🔒 YAZ-1775 D3): it is the image store, written and read by
 * the app alone, and its contents are content-hash names no one would ever click. Only the one
 * at the root — a folder the user made and called `assets` inside a subfolder is theirs, and
 * hiding it by name anywhere would be the app deciding what the user may see in their own vault.
 * Hidden from the TREE, not from disk: the sweep and the loader address it directly.
 */
export async function tree(root: string): Promise<TreeResponse> {
  const dir = requireAbsPath(root, 'root')
  await requireDir(dir)
  const nodes = await fsCall(dir, () => buildTree(dir))
  return { root: dir, tree: nodes.filter((n) => !(n.type === 'dir' && n.name === ASSETS_DIR)), generatedAt: Date.now() }
}
