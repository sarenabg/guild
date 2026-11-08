# Guild runner + site, for Google Cloud Run (or any container host).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV GUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 GUILD_DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
CMD ["node", "server.js"]
