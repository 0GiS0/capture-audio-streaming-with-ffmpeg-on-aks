FROM node:current-alpine3.10

# Create app directory
WORKDIR /usr/src/app

ENV FOLDER=""

COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

CMD [ "node", "job.js" ]