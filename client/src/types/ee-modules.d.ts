// CE/EE split is handled via webpack alias in next.config.mjs.
// @/ee resolves to ee/src/index.ts (EE) or src/ee-fallback.ts (CE) at build time.
// No ambient wildcard declaration needed — all imports use the barrel @/ee directly.
