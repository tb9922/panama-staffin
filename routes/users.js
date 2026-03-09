import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import { withTransaction } from '../db.js';
import * as userService from '../services/userService.js';
import * as userRepo from '../repositories/userRepo.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const usernameRegex = /^[a-zA-Z0-9._-]+$/;

const createUserSchema = z.object({
  username: z.string().min(3).max(100).regex(usernameRegex, 'Username must be alphanumeric with . _ -'),
  password: z.string().min(10).max(200),
  role: z.enum(['admin', 'viewer']),
  displayName: z.string().max(200).optional().default(''),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'viewer']).optional(),
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

const idSchema = z.coerce.number().int().positive();

// GET /api/users/all-homes — list all homes with integer IDs for access management (admin only)
// Must be defined BEFORE /:id to avoid being caught by the param route
router.get('/all-homes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const allHomes = await homeRepo.listAllWithIds();
    const accessibleIds = new Set(await userHomeRepo.findHomeIdsForUser(req.user.username));
    res.json(allHomes.filter(h => accessibleIds.has(h.id)));
  } catch (err) { next(err); }
});

// GET /api/users — list all users (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await userRepo.listAll();
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/users — create user (admin only)
router.post('/', writeRateLimiter, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { username, password, role, displayName } = parsed.data;
    const user = await userService.createUser(username, password, role, displayName, req.user.username);
    await auditService.log('user_create', '-', req.user.username, { username, role });
    res.status(201).json(user);
  } catch (err) {
    if (err.message === 'Username already exists') return res.status(409).json({ error: err.message });
    if (err.message?.startsWith('Password must')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/users/change-password — user changes own password (any role)
// MUST be defined BEFORE /:id routes to avoid being caught by the param route
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

// GET /api/users/:id — get single user (admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { next(err); }
});

// PUT /api/users/:id — update user (admin only)
router.put('/:id', writeRateLimiter, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    // Map frontend field names to DB columns
    const fields = {};
    if (parsed.data.role !== undefined) fields.role = parsed.data.role;
    if (parsed.data.displayName !== undefined) fields.display_name = parsed.data.displayName;
    if (parsed.data.active !== undefined) fields.active = parsed.data.active;

    const updated = await userService.updateUser(id.data, fields, req.user.username);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    await auditService.log('user_update', '-', req.user.username, { userId: id.data, changes: fields });
    res.json(updated);
  } catch (err) {
    if (err.message?.startsWith('Cannot')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/users/:id/reset-password — admin resets a user's password
router.post('/:id/reset-password', writeRateLimiter, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    await userService.resetPassword(id.data, parsed.data.newPassword, req.user.username);
    await auditService.log('user_password_reset', '-', req.user.username, { userId: id.data });
    res.json({ ok: true });
  } catch (err) {
    if (err.message?.startsWith('Password must') || err.message === 'User not found') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/users/:id/homes — list homes a user has access to (admin only)
router.get('/:id/homes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await userRepo.findById(id.data);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const homeIds = await userHomeRepo.findHomeIdsForUser(user.username);
    res.json({ homeIds });
  } catch (err) { next(err); }
});

// PUT /api/users/:id/homes — set homes a user has access to (admin only)
router.put('/:id/homes', writeRateLimiter, requireAuth, requireAdmin, async (req, res, next) => {
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

    // Validate acting admin has access to all homes being granted
    const actorHomeIds = new Set(await userHomeRepo.findHomeIdsForUser(req.user.username));
    const unauthorized = parsed.data.homeIds.filter(hid => !actorHomeIds.has(hid));
    if (unauthorized.length > 0) {
      return res.status(403).json({ error: 'You cannot grant access to homes you do not have access to' });
    }

    // Get current home IDs, then diff to grant/revoke — all in one transaction
    await withTransaction(async (client) => {
      const currentIds = new Set(await userHomeRepo.findHomeIdsForUser(user.username, client));
      const desiredIds = new Set(parsed.data.homeIds);

      for (const hid of desiredIds) {
        if (!currentIds.has(hid)) await userHomeRepo.grantAccess(user.username, hid, client);
      }
      for (const hid of currentIds) {
        if (!desiredIds.has(hid)) await userHomeRepo.revokeAccess(user.username, hid, client);
      }
    });

    await auditService.log('user_homes_update', '-', req.user.username, {
      userId: id.data, username: user.username, homeIds: parsed.data.homeIds,
    });
    res.json({ ok: true, homeIds: parsed.data.homeIds });
  } catch (err) { next(err); }
});

export default router;
