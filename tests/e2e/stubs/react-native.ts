// Minimal stand-in so the mobile app's API layer can run under Node.
export const Platform = {
  OS: 'android',
  select: <T>(spec: { android?: T; default?: T }) => spec.android ?? spec.default,
}
