import { Router } from 'express';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { getOnboardingDocs } from '../services/onboardingDocsService.js';
import { hasModuleAccess } from '../shared/roles.js';
import { canAccessSensitiveOnboarding } from '../shared/staffPolicy.js';

const router = Router();

function canReadOnboardingDocs(req) {
  if (req.user?.is_platform_admin && req.homeRole != null) return true;
  return hasModuleAccess(req.homeRole, 'compliance', 'read', { includeOwn: false })
    || canAccessSensitiveOnboarding(req.homeRole, { isPlatformAdmin: false });
}

function requireOnboardingAccess(req, res, next) {
  if (!canReadOnboardingDocs(req)) return res.status(403).json({ error: 'Onboarding document access denied' });
  next();
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess, async (req, res, next) => {
  try {
    res.json(await getOnboardingDocs(req.home.id, {
      roleId: req.homeRole,
      isPlatformAdmin: req.user?.is_platform_admin && req.homeRole != null,
    }));
  } catch (err) {
    next(err);
  }
});

export default router;
