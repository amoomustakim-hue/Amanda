FROM node:20-slim
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Cloud Run injects PORT; default to 8080 if not set
ENV NODE_ENV=production
ENV PORT=8080

# Expose port (informational)
EXPOSE 8080

CMD ["npm", "start"]
