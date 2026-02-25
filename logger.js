import pino from 'pino';
import { config } from './config.js';

const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
  }),
});

export default logger;
