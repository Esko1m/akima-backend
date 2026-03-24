/**
 * Custom Logger utility
 * Provides simple formatted logging for requests, errors, and system events.
 */

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  let log = `[${timestamp}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    log += ` | ${JSON.stringify(meta)}`;
  }
  return log;
};

const logger = {
  info: (message, meta = {}) => {
    console.log(formatMessage('INFO', message, meta));
  },
  error: (message, meta = {}) => {
    console.error(formatMessage('ERROR', message, meta));
  },
  warn: (message, meta = {}) => {
    console.warn(formatMessage('WARN', message, meta));
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatMessage('DEBUG', message, meta));
    }
  }
};

module.exports = logger;
