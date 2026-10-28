# Cookie clicker — small Express app backed by Postgres.
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Dependencies first so the layer caches when only server.js changes.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY server.js ./

USER node
EXPOSE 3000

# The app exits non-zero itself when DATABASE_URL is missing or Postgres is unreachable.
CMD ["node", "server.js"]
