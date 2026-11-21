# Nuxt (Nitro) éles kép. node:sqlite beépített → nincs natív fordítás.
# A build fázis a gép saját architektúráján fut (nem emulálva), mert a kimenet tiszta JS:
# így a Windows-on fordított arm64 kép is percek alatt elkészül.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    APP_TZ=Europe/Budapest \
    TZ=Europe/Budapest \
    CARELINK_INTERVAL=300 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
RUN mkdir -p /data
# A kész build + a parancssori import-szkript (node futtatja .ts-ként).
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server ./server
# Nem rootként fut. A /data mappa a hoston a 1000-es felhasználóé legyen: chown -R 1000:1000 <data mappa>
RUN chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
