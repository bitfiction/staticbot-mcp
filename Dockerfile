# Build stage: dev dependencies and TypeScript, none of which ship.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# The node image ships an unprivileged `node` user; the server needs no write access anywhere,
# so the filesystem can be mounted read-only by the Deployment.
USER node

EXPOSE 3000
# `node` directly rather than `npm start`: npm would sit between Kubernetes and the process and
# swallow SIGTERM, so pods would be killed after the grace period instead of draining in-flight
# requests.
CMD ["node", "dist/hosted/index.js"]
