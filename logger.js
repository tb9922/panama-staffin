import pino from 'pino';
import { config } from './config.js';
import { getRequestContext } from './requestContext.js';

const logger = pino({
  level: config.logLevel,
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
