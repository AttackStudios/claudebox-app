// Detects what we're running on so the right control scheme appears.
// Settings can override with 'mobile' / 'desktop' / 'auto'.

function detect() {
  const ua = navigator.userAgent;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const touchPoints = navigator.maxTouchPoints || 0;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && touchPoints > 1); // iPadOS lies
  const isAndroid = /Android/.test(ua);
  const isMobileUA = isIOS || isAndroid;
  const mobile = isMobileUA || (coarse && touchPoints > 0);
  return {
    mobile,
    desktop: !mobile,
    platform: isIOS ? 'ios' : isAndroid ? 'android' : /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'windows' : 'other',
    hasTouch: touchPoints > 0,
  };
}

export const device = detect();

// Resolve the effective mode given the user's settings override.
export function effectiveMode(override) {
  if (override === 'mobile') return 'mobile';
  if (override === 'desktop') return 'desktop';
  return device.mobile ? 'mobile' : 'desktop';
}
