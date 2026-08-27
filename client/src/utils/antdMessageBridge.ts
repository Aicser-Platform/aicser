import { message as staticMessage } from 'antd';
import type { App } from 'antd';

type MessageApi = ReturnType<typeof App.useApp>['message'];

/**
 * Non-component code (Zustand stores, plain service modules) can't call
 * App.useApp() - it's a hook. AntdMessageBridge (mounted once inside
 * <AntdApp> in ThemeProvider) captures the theme-aware message instance here
 * on mount; appMessage proxies every call to it. Falls back to the plain
 * static import if the bridge hasn't mounted yet (e.g. a call during initial
 * render), so this is always safe to use even before the bridge is ready -
 * just without dynamic-theme awareness for that one early call.
 */
let bridgedMessage: MessageApi | null = null;

export function setAntdMessageBridge(api: MessageApi | null): void {
  bridgedMessage = api;
}

export const appMessage: MessageApi = new Proxy({} as MessageApi, {
  get(_target, prop, receiver) {
    const api = bridgedMessage ?? staticMessage;
    return Reflect.get(api as object, prop, receiver);
  },
});
