# ReplayKit API for Railway. Serves /api/* only; the frontend is on Vercel.
FROM node:22-slim

WORKDIR /app

# Dev dependencies are needed at runtime: the server runs TypeScript through tsx.
# Install scripts are skipped; native binaries come from npm's platform packages.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force

COPY src ./src
COPY examples ./examples
COPY fixtures ./fixtures
COPY tsconfig.json ./

# Railway sets PORT. CORS_ORIGINS must be set in Railway to the Vercel URL.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_ONLY=1 \
    TRUST_PROXY=1 \
    RATE_LIMIT_PER_MINUTE=120

USER node
CMD ["node", "--import", "tsx", "src/web/server.ts"]
