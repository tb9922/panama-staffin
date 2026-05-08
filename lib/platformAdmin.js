export function isActivePlatformAdminUser(user) {
  return Boolean(
    user?.active === true
    && user?.role === 'admin'
    && user?.is_platform_admin === true
  );
}

export function verifiedPlatformAdminFromRequest(req) {
  return Boolean(
    req?.user?.role === 'admin'
    && req?.user?.is_platform_admin === true
    && isActivePlatformAdminUser(req?.authDbUser)
  );
}
