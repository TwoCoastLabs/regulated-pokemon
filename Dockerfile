# The hosted demo: the built app and the key relay, one small machine.
# The key itself is a deployment secret (`fly secrets set OPENROUTER_API_KEY=…`),
# never an image layer — this file copies no .env and bakes no credential.

FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run app:build && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /build/dist ./dist
COPY --from=build /build/app/dist ./app/dist
EXPOSE 8080
CMD ["node", "dist/relay/serve.js"]
