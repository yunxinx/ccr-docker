# claude-code-router Docker 镜像

> 2025年08月16日修复：Docker 镜像构建中的版本重复问题。之前由于 package.json 中使用 "latest" 标签，Docker 构建时会复用缓存中的旧版本依赖，导致不同版本标签实际指向同一个镜像。现在工作流会在构建前动态更新 package.json，将 "latest" 替换为具体的版本号（如"1.0.38"），确保每次构建都使用正确的上游版本。同时禁用了Docker构建缓存，保证每个版本都是独立构建的真实镜像。
>
> ~~修改对上游的检查时间从 1 小时一次到 3 小时一次~~
>
> 2025年09月15日更改：因为 CCR 更新已经稳定，因此修改构建时间为每周日早上 8 点一次，避免使用 Action 过多导致意外的后果

这是一个为 [`musistudio/claude-code-router`](https://github.com/musistudio/claude-code-router) 项目提供的非官方 Docker 镜像。

默认是每 3 小时检查一次上游提交情况，如果上游的提交包含了类似 "release v1.0.36" 或者 "v1.0.36" 这两种格式的提交的话，就会触发 Action 构建镜像。

并且镜像命名和 release 版本一致。

## 快速启动

1.  **准备配置文件**
    在需要部署的主机上创建一个 `config.json` 文件。

2.  **拉取并运行容器**
    执行以下命令来启动容器。请将 `/path/to/your/` 部分替换为自己的实际路径。

    ```bash
    docker run -d \
      --name my-ccr-service \
      -p 3456:3456 \
      -v /path/to/your/config.json:/root/.claude-code-router/config.json \
      yunxinc/ccr:latest
    ```

## 参数说明

*   `-d`: 在后台运行容器。
*   `--name my-ccr-service`: 为容器指定一个方便记忆的名称。
*   `-p 3457:3456`: 将主机的 `3456` 端口映射到容器的 `3456` 端口。可以根据需要更改主机端口 `3456` 为其他端口。
*   `-v /path/to/your/config.json:...` (**必需**): 将准备好的 `config.json` 文件挂载到容器内部。这是运行所必需的。

## 可选功能

### 在容器日志中查看详细日志

默认情况下，容器日志仅显示服务的启动信息。如果希望在 `docker logs` 的输出中实时看到详细的 `ccr-*.log` 文件内容，可以在启动时添加一个环境变量：

```bash
docker run -d \
  --name my-ccr-service \
  -p 3456:3456 \
  -e STREAM_LOG_FILE=true \
  -v /path/to/your/config.json:/root/.claude-code-router/config.json \
  yunxinc/ccr:latest
```

### 持久化存储日志文件

大概是从 2025年08月12日 还是之前的哪一次 CCR 版本更新后，默认就不输出日志信息，而是做了拆分，在 .logs 目录中创建带有时间戳的日志文件。

所以如果需要持久化存储这一部分内容，可以加上一个 `-v /path/to/your/ccr-logs:/root/.claude-code-router/logs` 这样的参数，将这个路径挂载到自己的本机目录下。

## 镜像标签说明

*   `yunxinc/ccr:latest`: 总是指向最新一次成功构建的镜像。
*   `yunxinc/ccr:vX.Y.Z`: 指向一个具体的版本，与上游 `claude-code-router` 仓库的 `release` 版本相对应，提供了更好的版本稳定性。
