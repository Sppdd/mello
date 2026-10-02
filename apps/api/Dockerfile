# Mello API. Build from the repo root so the shared package is included:
#   docker build -f apps/api/Dockerfile -t mello-api .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Install only the API and the shared package (not the mobile app). tsx runs the TypeScript directly.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @mello/api --workspace @mello/shared --include=dev --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY apps/api/sql apps/api/sql
COPY apps/api/tsconfig.json apps/api/

USER node
EXPOSE 8787
CMD ["npm", "start", "--workspace", "@mello/api"]
