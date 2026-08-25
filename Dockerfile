FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
COPY scripts/patch-mermaid.mjs ./scripts/patch-mermaid.mjs
RUN npm ci
COPY . .
RUN npm run build:web

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=5222
ENV HOST=0.0.0.0
ENV WORKSPACE_ROOT=/workspace

WORKDIR /app
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /workspace
EXPOSE 5222
VOLUME ["/workspace"]

CMD ["node", "dist-web/web/server.js"]
