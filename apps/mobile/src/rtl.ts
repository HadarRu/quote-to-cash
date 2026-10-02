import { I18nManager, Platform } from 'react-native';

/**
 * Forces RTL layout on native. Native builds already start in RTL via `extra.forcesRTL`
 * in app.json; this covers Expo Go / dev clients (applies after one reload).
 * Web direction comes from `<html dir="rtl">` in app/+html.tsx.
 */
export function forceRtl(): void {
  if (Platform.OS === 'web') return;
  I18nManager.allowRTL(true);
  if (!I18nManager.isRTL) I18nManager.forceRTL(true);
}

export function isRtl(): boolean {
  if (Platform.OS === 'web') {
    return typeof document === 'undefined' || document.documentElement.dir === 'rtl';
  }
  return I18nManager.isRTL;
}
