FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy server source
COPY server/ ./server/

# Copy client (static files served by Express)
COPY client/ ./client/

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "server.js"]
