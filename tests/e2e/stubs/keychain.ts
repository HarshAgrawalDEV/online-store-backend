// In-memory replacement for the device keychain used by the mobile token store.
let stored: { password: string } | false = false
export const getGenericPassword = async () => stored
export const setGenericPassword = async (_user: string, password: string) => {
  stored = { password }
  return true
}
export const resetGenericPassword = async () => {
  stored = false
  return true
}
