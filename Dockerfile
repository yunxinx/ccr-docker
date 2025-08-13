# 指定 Alpine 版本为 3.22，确保构建环境的稳定性
FROM node:22-alpine3.22 AS builder

WORKDIR /app

# 复制 package.json 并只安装生产依赖
COPY package.json .
RUN npm install --omit=dev

# 同样将最终镜像的基础锁定到具体的 Alpine 3.22 版本
FROM alpine:3.22

# 在这个最小的系统上，只安装运行所需的 Node.js 运行时
RUN apk add --no-cache nodejs

# 设置工作目录
WORKDIR /app

# 从 builder 阶段，精准地只复制最终的、干净的 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制我们的启动脚本
COPY entrypoint.js .

ENV STREAM_LOG_FILE=false
EXPOSE 3456

# 设置入口点，使用 Alpine 安装的 node 来运行脚本
ENTRYPOINT ["node", "entrypoint.js"]
