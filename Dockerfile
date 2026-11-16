# dudee: open-source AI employees, self-hosted.
#
#   docker build -t dudee .
#   docker run -d -p 127.0.0.1:4777:4777 -v dudee-data:/data --env-file .env -e DUDE_UI_TOKEN=change-me dudee
#   open http://localhost:4777/?token=change-me
#
# The image installs the same `dudee` npm package people get from npm, built from this repo.

# ── build: compile the workspace and pack the dudee package ──────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN npm install -g pnpm@8.15.9
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && cd apps/cli && pnpm pack --pack-destination /out

# ── run: just Node and the packed package ────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DUDE_HOME=/data \
    DUDE_HOST=0.0.0.0 \
    DUDE_PORT=4777 \
    DUDE_BROWSER_HEADLESS=1
COPY --from=build /out/dudee-*.tgz /tmp/
RUN npm install -g /tmp/dudee-*.tgz && rm /tmp/dudee-*.tgz \
 && mkdir -p /data && chown node:node /data
COPY docker/entrypoint.sh /usr/local/bin/dudee-entrypoint
RUN chmod +x /usr/local/bin/dudee-entrypoint

USER node
WORKDIR /data
VOLUME ["/data"]
EXPOSE 4777
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DUDE_PORT||4777)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dudee-entrypoint"]
CMD ["ui", "--no-open"]
