FROM node:alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./

RUN yarn

COPY . .

RUN yarn run build

FROM node:alpine AS production
LABEL org.opencontainers.image.source https://github.com/endworks/canopus

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./
COPY .env ./

RUN yarn --prod

COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3000/tcp

CMD ["yarn", "run", "start:prod"]