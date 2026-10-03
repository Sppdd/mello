# Mello API. Build from the repo root so the shared package is included:
#   docker build -f apps/api/Dockerfile -t mello-api .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
# Voice uploads. Container disks are wiped on redeploy; see docs/DEPLOY.md.
ENV UPLOAD_DIR=/tmp/mello-audio
# Only used when DATABASE_URL is unset (a throwaway demo database).
ENV PGLITE_PATH=/tmp/mello-pglite

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
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch(`http://localhost:${process.env.PORT||8787}/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start", "--workspace", "@mello/api"]
