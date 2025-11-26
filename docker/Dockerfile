# QRIS Watcher - Docker Image
FROM node:20-slim

# Install dependencies untuk Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment untuk Puppeteer menggunakan Chromium sistem
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY scripts/ ./scripts/
COPY fetch_transactions.py ./

# Create volume untuk persistent data
VOLUME ["/app/data"]

# Default command - jalankan watcher
CMD ["node", "scripts/watch_transactions.js"]
