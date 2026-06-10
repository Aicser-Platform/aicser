/** True when viewer chrome should be hidden (iframe embed or ?embed=1). */
export function isEmbedChromeHidden(searchParams: URLSearchParams | null): boolean {
  if (searchParams?.get('embed') === '1' || searchParams?.get('chrome') === '0') {
    return true;
  }
  if (typeof window !== 'undefined' && window.parent !== window) {
    return true;
  }
  return false;
}
