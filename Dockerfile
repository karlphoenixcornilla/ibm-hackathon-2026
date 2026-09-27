# Reprise backend (issue #30): builds @reprise/core, then the server, into a slim runtime image.
# The Review UI (#33) will add a web build stage and copy its dist into /app/web/dist.

FROM node:22-slim AS build
WORKDIR /app

COPY core/package.json core/package-lock.json core/
RUN cd core && npm ci
COPY core/ core/
RUN cd core && npm run build && npm prune --omit=dev

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY server/ server/
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=build /app/core/package.json core/package.json
COPY --from=build /app/core/out/src core/out/src
COPY --from=build /app/core/node_modules core/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/openapi.yaml server/openapi.yaml
COPY --from=build /app/server/public server/public
COPY --from=build /app/server/out/src server/out/src
COPY --from=build /app/server/out/fixtures server/out/fixtures
COPY --from=build /app/server/node_modules server/node_modules
USER node
WORKDIR /app/server
EXPOSE 10000
CMD ["node", "out/src/main.js"]
