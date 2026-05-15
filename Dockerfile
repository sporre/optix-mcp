FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS build
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
RUN bun run build

FROM base AS install-prod
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM base AS release
COPY --from=install-prod /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY package.json ./
USER bun
ENTRYPOINT ["bun", "run", "dist/index.js"]
