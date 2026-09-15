// CE fallback so Providers can default-import FeaturebaseMessenger without
// pulling the @/ee barrel (ChatPage / ChatPanel cycle).
export { FeaturebaseMessenger as default } from './ee-fallback';
