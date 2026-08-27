// CE build fallback for @/ee/api/pricingProxy — see src/ee-fallback.ts for the
// full CE stub set. Split out separately so API routes (route.ts handlers) can
// import just the proxy functions without pulling in the full @/ee barrel,
// which re-exports UI components (e.g. ThoughtProcessDisplay -> @ant-design/icons)
// that fail with "createContext is not a function" when bundled into a route
// handler's server module graph.
export { proxyEeBillingRequest, proxyEePricingRequest } from './ee-fallback';
