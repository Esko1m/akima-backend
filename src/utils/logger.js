const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, '../../server-logs.txt');

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  let log = `[${timestamp}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    log += ` | ${JSON.stringify(meta)}`;
  }
  return log;
};

const writeToFile = (msg) => {
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch (err) {
    // Ignore log file errors
  }
};

const logger = {
  info: (message, meta = {}) => {
    const msg = formatMessage('INFO', message, meta);
    console.log(msg);
    writeToFile(msg);
  },
  error: (message, meta = {}) => {
    const msg = formatMessage('ERROR', message, meta);
    console.error(msg);
    writeToFile(msg);
  },
  warn: (message, meta = {}) => {
    const msg = formatMessage('WARN', message, meta);
    console.warn(msg);
    writeToFile(msg);
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      const msg = formatMessage('DEBUG', message, meta);
      console.debug(msg);
      writeToFile(msg);
    }
  }
};

module.exports = logger;
