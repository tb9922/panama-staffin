import pino from 'pino';
import { config } from './config.js';
import { getRequestContext } from './requestContext.js';

export const LOGGER_REDACT_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'headers.set-cookie',
  'headers.x-csrf-token',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.headers.x-csrf-token',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.cookies',
  'authorization',
  'cookie',
  'password',
  'password_hash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'invite_token',
  'panama_token',
  'panama_csrf',
  'email',
  'phone',
  'mobile',
  'dob',
  'date_of_birth',
  'ni_number',
  'national_insurance',
  'lat',
  'lng',
  'body.password',
  'body.password_hash',
  'body.currentPassword',
  'body.newPassword',
  'body.confirmPassword',
  'body.token',
  'body.invite_token',
  'body.email',
  'body.phone',
  'body.mobile',
  'body.dob',
  'body.date_of_birth',
  'body.ni_number',
  'body.national_insurance',
  'body.lat',
  'body.lng',
  'req.body.password',
  'req.body.password_hash',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.invite_token',
  'req.body.email',
  'req.body.phone',
  'req.body.mobile',
  'req.body.dob',
  'req.body.date_of_birth',
  'req.body.ni_number',
  'req.body.national_insurance',
  'req.body.lat',
  'req.body.lng',
  'payload.password',
  'payload.password_hash',
  'payload.token',
  'payload.invite_token',
  'payload.email',
  'payload.phone',
  'payload.mobile',
  'payload.dob',
  'payload.date_of_birth',
  'payload.ni_number',
  'payload.national_insurance',
  'payload.lat',
  'payload.lng',
];

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: LOGGER_REDACT_PATHS,
    censor: '[REDACTED]',
  },
  mixin() {
    const { reqId, homeSlug, username } = getRequestContext();
    const context = {};
    if (reqId) context.reqId = reqId;
    if (homeSlug) context.homeSlug = homeSlug;
    if (username) context.username = username;
    return context;
  },
  ...(config.nodeEnv !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
  }),
});

export default logger;
