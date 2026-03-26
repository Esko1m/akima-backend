const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const logger = require('./utils/logger');

// Load Routes
const searchRoute = require('./routes/search');
const streamRoute = require('./routes/stream');
const telegramRoute = require('./routes/telegram');

// Services
const telegramService = require('./services/telegramService');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Core Security Middlewares
app.use(helmet());
app.use(cors({ origin: '*' })); // Configure explicitly for prod

// 2. Rate Limiting Middleware (Security & Stability)
// 20 requests per IP per minute
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again later.' }
});

app.use(limiter);

// 3. Body Parsing Content
app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 4. HTTP Request Logging using Morgan -> custom logger
app.use(morgan('short', {
    stream: { write: message => logger.info(message.trim()) }
}));

// Route Middlewares
app.use('/search', searchRoute);
app.use('/stream', streamRoute);
app.use('/telegram', telegramRoute);

// Health check / Base Endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'akima-music-streaming-backend' });
});

// 404 Route Handler
app.use((req, res, next) => {
    res.status(404).json({ error: 'Endpoint Not Found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    logger.error('Unhandled server error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal Server Error' });
});

// Start listening (Explicitly on 0.0.0.0 to allow network access)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server initialized successfully on http://0.0.0.0:${PORT}`);
    });
}

module.exports = app;
