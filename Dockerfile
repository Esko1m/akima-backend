# Use official Node.js lightweight image (Node 20+ for stable Fetch support)
FROM node:20-bullseye-slim

# Install dependencies (vital for yt-dlp audio handling)
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install the latest yt-dlp via pip (handles dependencies much better)
RUN pip3 install --no-cache-dir yt-dlp

# Set working directory
WORKDIR /app

# Copy dependency definitions and install production packages
COPY package*.json ./
RUN npm install --production

# Copy all other application source code
COPY . .

# Expose the API port
EXPOSE 3000

# Start the Node.js server
CMD ["node", "src/server.js"]
