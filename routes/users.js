import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlatformAdmin, requireHomeAccess, requireHomeManager } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { withTransaction } from '../db.js';
import * as userService from '../services/userService.js';
import * as userRepo from '../repositories/userRepo.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';
import * as authService from '../services/authService.js';
import { ROLE_IDS, canAssignRole } from '../shared/roles.js';

const router = Router();

const usernameRegex = /^[a-zA-Z0-9._-]+$/;

const createUserSchema = z.object({
  username: z.string().min(3).max(100).regex(usernameRegex, 'Username must be alphanumeric with . _ -'),
  password: z.string().min(10).max(200),
  role: z.enum(['viewer']),
  displayName: z.string().max(200).optional().default(''),
  homeRoleId: z.enum(ROLE_IDS).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['viewer']).optional(),
  displayName: z.string().max(200).optional(),
  active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(10).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

const setHomesSchema = z.object({
  homeIds: z.array(z.number().int().positive()),
});

const setRolesSchema = z.object({
  roles: z.array(z.object({
    homeId: z.number().int().positive(),
    roleId: z.enum(ROLE_IDS),
  })),
});

const setHomeRoleSchema = z.object({
  roleId: z.enum(ROLE_IDS),
});

const idSchema = z.coerce.number().int().positive();

// ── Platform-only endpoints (must be defined BEFORE /:id param routes) ───────

// GET /api/users/all-homes — list all homes with integer IDs for access management
router.get('/all-homes', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const allHomes = await homeRepo.listAllWithIds();
    res.json(allHomes);
  } catch (err) { next(err); }
});

// GET /api/users/all-roles/:id — get all role assignments for a user across all homes (platform admin only)
// Must be defined BEFORE /:id to avoid param route catch
router.get('/all-roles/:id', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const roles = await userHomeRepo.findRolesForUser(user.username);
    res.json({ roles });
  } catch (err) { next(err); }
});

// POST /api/users/change-password — user changes own password (any role)
router.post('/change-password', writeRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    await userService.changeOwnPassword(req.user.username, parsed.data.currentPassword, parsed.data.newPassword);
    await auditService.log('user_password_change', '-', req.user.username, null);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'Current password is incorrect') return res.status(400).json({ error: err.message });
    if (err.message?.startsWith('Password must')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── Per-home endpoints (home_manager OR platform admin) ──────────────────────

// GET /api/users?home=:slug — list users at this home, ordered by role hierarchy
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const users = await userRepo.findByHome(req.home.id);
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/users?home=:slug — create user and optionally assign role at this home
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { username, password, role, displayName, homeRoleId } = parsed.data;

    // If assigning a role, validate permission
    if (homeRoleId && !req.user.is_platform_admin) {
      if (!canAssignRole(req.homeRole, homeRoleId)) {
        return res.status(403).json({
          error: homeRoleId === 'home_manager'
            ? 'Only platform admins can assign the Home Manager role'
            : `Your role does not allow assigning ${homeRoleId}`,
        });
      }
    }

    const user = await withTransaction(async (client) => {
      const created = await userService.createUser(username, password, role, displayName, req.user.username, client);
      // Assign role at this home (defaults to viewer if no specific role requested)
      const effectiveRole = homeRoleId || 'viewer';
      await userHomeRepo.assignRole(username, req.home.id, effectiveRole, null, req.user.username, client);
      return created;
    });

    await auditService.log('user_create', req.home.slug, req.user.username, { username, role, homeRoleId });
    res.status(201).json(user);
  } catch (err) {
    if (err.message === 'Username already exists') return res.status(409).json({ error: err.message });
    if (err.message?.startsWith('Password must')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /api/users/:id?home=:slug — get single user (only if they have role at this home)
router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findByIdAtHome(id.data, req.home.id);
    if (!user) return res.status(404).json({ error: 'User not found at this home' });
    res.json(user);
  } catch (err) { next(err); }
});

// PUT /api/users/:id?home=:slug — update user (only if they have role at this home)
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    // Verify target user belongs to this home
    const targetAtHome = await userRepo.findByIdAtHome(id.data, req.home.id);
    if (!targetAtHome) return res.status(404).json({ error: 'User not found at this home' });

    const fields = {};
    if (parsed.data.role !== undefined) fields.role = parsed.data.role;
    if (parsed.data.displayName !== undefined) fields.display_name = parsed.data.displayName;
    if (parsed.data.active !== undefined) fields.active = parsed.data.active;

    const updated = await userService.updateUser(id.data, fields, req.user.username);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    await auditService.log('user_update', req.home.slug, req.user.username, { userId: id.data, changes: fields });
    res.json(updated);
  } catch (err) {
    if (err.message?.startsWith('Cannot')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/users/:id/reset-password?home=:slug — reset a user's password
router.post('/:id/reset-password', writeRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    // Verify target user belongs to this home
    const targetAtHome = await userRepo.findByIdAtHome(id.data, req.home.id);
    if (!targetAtHome) return res.status(404).json({ error: 'User not found at this home' });

    await userService.resetPassword(id.data, parsed.data.newPassword, req.user.username);
    await auditService.log('user_password_reset', req.home.slug, req.user.username, { userId: id.data });
    res.json({ ok: true });
  } catch (err) {
    if (err.message?.startsWith('Password must') || err.message === 'User not found') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/users/:id/homes — list homes a user has access to (platform admin only)
router.get('/:id/homes', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const homeIds = await userHomeRepo.findHomeIdsForUser(user.username);
    res.json({ homeIds });
  } catch (err) { next(err); }
});

// PUT /api/users/:id/homes — set homes a user has access to (platform admin only)
router.put('/:id/homes', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = setHomesSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent admin from modifying their own home access
    if (user.username === req.user.username) {
      return res.status(400).json({ error: 'Cannot modify your own home access' });
    }

    // Get current home IDs, then diff to assign/remove — all in one transaction
    await withTransaction(async (client) => {
      const currentIds = new Set(await userHomeRepo.findHomeIdsForUser(user.username, client));
      const desiredIds = new Set(parsed.data.homeIds);

      for (const hid of desiredIds) {
        if (!currentIds.has(hid)) {
          // Default to viewer role — use roles-bulk endpoint to set specific roles
          await userHomeRepo.assignRole(user.username, hid, 'viewer', null, req.user.username, client);
        }
      }
      for (const hid of currentIds) {
        if (!desiredIds.has(hid)) await userHomeRepo.removeRole(user.username, hid, client);
      }
    });

    await auditService.log('user_homes_update', '-', req.user.username, {
      userId: id.data, username: user.username, homeIds: parsed.data.homeIds,
    });
    res.json({ ok: true, homeIds: parsed.data.homeIds });
  } catch (err) { next(err); }
});

// GET /api/users/:id/roles?home=:slug — get user's role at this home
router.get('/:id/roles', readRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Return role at this home only (not all homes)
    const allRoles = await userHomeRepo.findRolesForUser(user.username);
    const homeRole = allRoles.find(r => r.home_id === req.home.id);
    res.json({ role: homeRole || null });
  } catch (err) { next(err); }
});

// PUT /api/users/:id/roles?home=:slug — set user's role at this home
router.put('/:id/roles', writeRateLimiter, requireAuth, requireHomeAccess, requireHomeManager, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = setHomeRoleSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cannot modify your own roles
    if (user.username === req.user.username) {
      return res.status(400).json({ error: 'Cannot modify your own role assignments' });
    }

    // Permission check
    if (!req.user.is_platform_admin) {
      if (!canAssignRole(req.homeRole, parsed.data.roleId)) {
        return res.status(403).json({
          error: parsed.data.roleId === 'home_manager'
            ? 'Only platform admins can assign the Home Manager role'
            : `Your role does not allow assigning ${parsed.data.roleId}`,
        });
      }
    }

    // Get old role for audit
    const oldRoles = await userHomeRepo.findRolesForUser(user.username);
    const oldHomeRole = oldRoles.find(r => r.home_id === req.home.id);

    await userHomeRepo.assignRole(user.username, req.home.id, parsed.data.roleId, null, req.user.username);

    const changed = !oldHomeRole || oldHomeRole.role_id !== parsed.data.roleId;
    if (changed) {
      await auditService.log('user_roles_update', req.home.slug, req.user.username, {
        userId: id.data, username: user.username,
        changes: [{ homeId: req.home.id, from: oldHomeRole?.role_id || null, to: parsed.data.roleId }],
      });
      // Force re-login so JWT reflects new permissions
      await authService.revokeUser(user.username);
    }

    res.json({ ok: true, roleId: parsed.data.roleId });
  } catch (err) { next(err); }
});

// PUT /api/users/:id/roles-bulk — set per-home role assignments across multiple homes (platform admin only)
router.put('/:id/roles-bulk', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = setRolesSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.username === req.user.username) {
      return res.status(400).json({ error: 'Cannot modify your own role assignments' });
    }

    const currentRoles = await userHomeRepo.findRolesForUser(user.username);

    // Build old roles map and final desired set for audit diff
    const oldRoleMap = new Map(currentRoles.map(r => [r.home_id, r.role_id]));
    const finalDesiredHomeIds = new Set(parsed.data.roles.map(r => r.homeId));

    await withTransaction(async (client) => {
      const finalHomeIds = new Set();
      for (const { homeId, roleId } of parsed.data.roles) {
        await userHomeRepo.assignRole(user.username, homeId, roleId, null, req.user.username, client);
        finalHomeIds.add(homeId);
      }
      for (const cr of currentRoles) {
        if (!finalHomeIds.has(cr.home_id)) {
          await userHomeRepo.removeRole(user.username, cr.home_id, client);
        }
      }
    });

    // Build audit diff using final desired set (after preservation)
    const changes = [];
    for (const { homeId, roleId } of parsed.data.roles) {
      const oldRole = oldRoleMap.get(homeId);
      if (oldRole !== roleId) changes.push({ homeId, from: oldRole || null, to: roleId });
    }
    for (const cr of currentRoles) {
      if (!finalDesiredHomeIds.has(cr.home_id)) {
        changes.push({ homeId: cr.home_id, from: cr.role_id, to: null });
      }
    }

    if (changes.length > 0) {
      await auditService.log('user_roles_update', '-', req.user.username, {
        userId: id.data, username: user.username, changes,
      });
      await authService.revokeUser(user.username);
    }

    res.json({ ok: true, roles: parsed.data.roles });
  } catch (err) { next(err); }
});

export default router;
