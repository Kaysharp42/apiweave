FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

RUN npm run build

# Expose port
EXPOSE 3000

CMD ["npm", "run", "prod"]
