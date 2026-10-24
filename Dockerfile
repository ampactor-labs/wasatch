# The conductor's image (conductor/README.md). Railway builds this file; the
# site itself is GitHub Pages and never runs in a container.
#
# Node 24 runs the TypeScript directly, and the conductor shares the page's
# feed, seismometer and protocol code, so those are all it needs: no build
# step, no dependencies.
FROM node:24-slim

WORKDIR /app
# "type": "module", so Node reads the .ts files as ES modules.
COPY package.json ./
COPY conductor/src ./conductor/src
COPY web/src/data ./web/src/data
COPY web/src/engine/protocol.ts ./web/src/engine/protocol.ts

ENV NODE_ENV=production
# It starts as root only to hand a mounted volume (root-owned on Railway) to
# the node user, then drops root before it opens a port (server.ts).
EXPOSE 8080
CMD ["node", "conductor/src/server.ts"]
