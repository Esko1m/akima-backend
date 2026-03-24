# Use official Node.js lightweight image
FROM node:18-bullseye-slim

# Install wget and python3 (yt-dlp utilizes Python under the hood)
RUN apt-get update && apt-get install -y wget python3 \
    && rm -rf /var/lib/apt/lists/*

# Download the latest yt-dlp standalone Linux binary and make it executable globally
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

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
