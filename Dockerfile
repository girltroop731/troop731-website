FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy application code
COPY . .

# Data directory — mount a volume here for persistence
ENV DATA_DIR=/data
VOLUME ["/data"]

RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /data && chown -R app:app /app /data
USER app

EXPOSE 3000

CMD ["node", "server.js"]
