# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.5.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
ENV HUSKY=0 CI=true
RUN pnpm install --frozen-lockfile

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Chỉ giữ dependencies production
RUN pnpm prune --prod --ignore-scripts

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# uploads và KYC media ghi ra đĩa, mount volume vào đây
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3001
CMD ["node", "dist/main.js"]
