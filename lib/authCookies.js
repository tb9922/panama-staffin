export function isSecureRequest(req) {
  if (req?.secure || req?.socket?.encrypted) return true;
  const trustProxy = req?.app?.get?.('trust proxy');
  if (!trustProxy) return false;
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  if (typeof forwardedProto !== 'string') return false;
  return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
}

export function tokenCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 4 * 60 * 60 * 1000,
  };
}

export function csrfCookieOptions(req) {
  return {
    httpOnly: false,
    secure: isSecureRequest(req),
    sameSite: 'strict',
    path: '/',
    maxAge: 4 * 60 * 60 * 1000,
  };
}

export function legacyCsrfClearCookieOptions(req) {
  return {
    path: '/api',
    secure: isSecureRequest(req),
    sameSite: 'strict',
  };
}

export function logoutTokenClearCookieOptions(req, path = '/') {
  return {
    path,
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
  };
}

export function logoutCsrfClearCookieOptions(req) {
  return {
    path: '/',
    secure: isSecureRequest(req),
    sameSite: 'strict',
  };
}
