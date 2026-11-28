# Build from the REPO ROOT (the server bundles ../src):  docker build -f agent/Dockerfile -t pp-agent .
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY canvas-kit ./canvas-kit
COPY agent/package.json agent/package-lock.json ./agent/
RUN cd agent && npm ci
COPY agent ./agent
RUN cd agent && npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
COPY --from=build /repo/agent/dist ./dist
COPY --from=build /repo/agent/node_modules ./node_modules
COPY --from=build /repo/agent/package.json ./
ENV NODE_ENV=production PORT=8080
USER node
CMD ["node", "dist/http.js"]
