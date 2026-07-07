# ClaudeBox — container image for cloud hosting (Fly.io / Render / Railway / any).
FROM node:20-alpine
WORKDIR /app

# install prod deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# app source
COPY . .

ENV NODE_ENV=production
# the server reads process.env.PORT; hosts override this as needed
ENV PORT=8080
EXPOSE 8080

# boot.js restores cloud data first, then starts the server (same process,
# so the shutdown flush works). With no cloud env set it's just a passthrough.
CMD ["node", "server/boot.js"]
