import dns from 'node:dns/promises';

// Block private/internal IPs to prevent SSRF (covers RFC 1918, link-local, loopback, cloud metadata)
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|::$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80|\[::1\]|\[0{1,4}(:{1,2}0{0,4}){0,6}:?0{0,3}1\])/i;

/**
 * Normalise a dotted IPv4 address that may use octal (0177.0.0.1) or hex (0xA.0.0.1)
 * notation in each octet.  Returns the dotted-decimal string, or null if not a valid
 * 4-part IPv4 address in any of these forms.
 */
function normalizeDottedIpv4(h) {
  const parts = h.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(p => {
    if (/^0x[0-9a-f]+$/i.test(p)) return parseInt(p, 16);
    if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
    if (/^[0-9]+$/.test(p)) return parseInt(p, 10);
    return NaN;
  });
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return nums.join('.');
}

export function isPrivateHost(h) {
  if (PRIVATE_HOST_RE.test(h)) return true;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  if (/^::ffff:/i.test(h)) return true;
  // Single-value integer forms: 0x7f000001, 2130706433, 0177 etc.
  if (/^(0x[0-9a-f]+|[0-9]+|0[0-7]+)$/i.test(h)) return true;
  // Dotted-octal / dotted-hex IPv4 bypass (e.g. 0177.0.0.1 → 127.0.0.1)
  if (h.includes('.')) {
    const normalized = normalizeDottedIpv4(h);
    if (normalized && normalized !== h) {
      if (PRIVATE_HOST_RE.test(normalized)) return true;
      if (normalized === '169.254.169.254') return true;
    }
  }
  return false;
}

export function isPrivateUrl(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^\[|\]$/g, '');
    return isPrivateHost(h);
  } catch { return true; }
}

/**
 * DNS resolution check — prevents DNS rebinding attacks where a hostname
 * initially resolves to a public IP but later resolves to a private one.
 */
export async function resolvedToPrivateIp(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^\[|\]$/g, '');
    if (/^[\d.:a-fA-F]+$/.test(h)) return false;
    const addresses = await dns.resolve4(h).catch(() => []);
    const addresses6 = await dns.resolve6(h).catch(() => []);
    for (const ip of [...addresses, ...addresses6]) {
      if (isPrivateHost(ip)) return true;
    }
    return false;
  } catch { return true; }
}
