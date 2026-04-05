const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const logger = require('./utils/logger');

// Load Routes
const searchRoute = require('./routes/search');
const streamRoute = require('./routes/stream');
const proxyRoute = require('./routes/proxy');

// Services
// (No special services needed for core routes)

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
app.use('/proxy', proxyRoute);

// Health check / Base Endpoint with Landing Page
app.get('/', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const fullUrl = `${protocol}://${host}`;

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Akima Music | Connect</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background: #0f172a;
                    color: white;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    text-align: center;
                }
                .card {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 2.5rem;
                    border-radius: 2rem;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    max-width: 90%;
                    width: 400px;
                }
                h1 { margin: 0 0 0.5rem 0; font-weight: 800; letter-spacing: -0.025em; }
                p { color: #94a3b8; margin: 0 0 2rem 0; line-height: 1.5; }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                    text-decoration: none;
                    padding: 1rem 2rem;
                    border-radius: 1rem;
                    font-weight: 600;
                    font-size: 1.1rem;
                    transition: transform 0.2s, box-shadow 0.2s;
                    box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.3);
                }
                .btn:active { transform: scale(0.95); }
                .footer { margin-top: 2rem; font-size: 0.8rem; color: #475569; }
                .status { 
                    display: inline-flex; 
                    align-items: center; 
                    background: rgba(34, 197, 94, 0.1); 
                    color: #4ade80; 
                    padding: 0.25rem 0.75rem; 
                    border-radius: 100px; 
                    font-size: 0.8rem;
                    margin-bottom: 1.5rem;
                }
                .dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 6px; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="status"><div class="dot"></div> Server Online</div>
                <h1>Sync Akima</h1>
                <p>Click below to automatically connect your phone app to this server.</p>
                <a href="akima://set-server?url=${encodeURIComponent(fullUrl)}" class="btn">Connect to App</a>
            </div>
            <div class="footer">Server: ${fullUrl}</div>
        </body>
        </html>
    `);
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
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Akima Local Backend running on http://localhost:${PORT}`);
});

module.exports = app;
