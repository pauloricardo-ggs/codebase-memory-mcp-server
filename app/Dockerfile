FROM node:22-alpine

RUN apk add --no-cache ca-certificates git openssh-client

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
