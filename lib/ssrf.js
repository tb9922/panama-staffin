import dns from 'node:dns/promises';

// Block private/internal IPs to prevent SSRF (covers RFC 1918, link-local, loopback, cloud metadata)
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fc|fd|fe80|\[::1\])/i;

export function isPrivateHost(h) {
  if (PRIVATE_HOST_RE.test(h)) return true;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  if (/^::ffff:/i.test(h)) return true;
  if (/^(0x[0-9a-f]+|[0-9]+|0[0-7]+)$/i.test(h)) return true;
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
