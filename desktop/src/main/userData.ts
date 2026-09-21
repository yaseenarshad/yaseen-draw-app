export interface UserDataPathOwner {
  setPath(name: 'userData', path: string): void
}

/** Opt-in demo/test isolation; absent in normal launches, so the production profile is untouched. */
export function applyUserDataOverride(app: UserDataPathOwner, value: string | undefined): void {
  const path = value?.trim()
  if (path !== undefined && path !== '') app.setPath('userData', path)
}
