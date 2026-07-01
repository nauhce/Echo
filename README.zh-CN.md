# Echo

Echo 是一个轻量级 HTML 原型和需求评审工具。

它会在本机启动一个小型 Web 服务。你可以导入 HTML 文件，或者从可访问链接保存页面快照，然后把评审链接发给同一局域网或 VPN 内的同事。同事可以选中页面元素添加评论、回复、标记已解决，也可以协作补充需求说明。

## 功能

- 导入独立 HTML 文件。
- 从可访问 URL 保存本地快照。
- 通过局域网或 VPN 分享评审链接。
- 对页面元素和区域添加评论。
- 支持回复、解决、重开评论。
- 对选中的 UI 区域编写需求说明。
- 配置 OpenAI 兼容 API Key 后，可用 AI 补足需求草稿。
- 支持配置需求文档协作者。
- 支持中文和英文全局切换。
- 评审数据和导入文件保存在启动机器本地。

## 启动方式

启动文件都在：

```text
startup-methods/
```

Windows：

- `startup-methods/windows-echo.bat`：有窗口启动，推荐日常启动和排查问题。
- `startup-methods/windows-echo-hidden.vbs`：无黑框启动，适合日常使用。
- `startup-methods/windows-echo-stop.bat`：停止占用 `5177` 端口的 Echo 服务。

macOS：

- `startup-methods/macos-echo.command`：有窗口启动，推荐日常启动和排查问题。
- `startup-methods/macos-echo-stop.command`：停止占用 `5177` 端口的 Echo 服务。

macOS 下载或解压后，需要先执行一次授权：

```sh
chmod +x startup-methods/macos-echo.command startup-methods/macos-echo-stop.command
```

启动后访问：

```text
http://localhost:5177
```

更详细的启动说明见 [startup-methods/README.zh-CN.md](startup-methods/README.zh-CN.md)。

## 手动运行

如果你想用终端启动，正常运行不需要安装依赖：

```sh
node server.js
```

默认端口是 `5177`。也可以自定义端口：

```sh
PORT=3000 node server.js
```

Windows PowerShell：

```powershell
$env:PORT=3000
node server.js
```

## 评审流程

1. 启动 Echo，打开 `http://localhost:5177`。
2. 导入 HTML 文件，或从 URL 保存页面快照。
3. 打开生成的评审页面。
4. 把局域网或 VPN 可访问的评审链接发给同事。
5. 同事输入姓名后，可以切换查看、评论、需求模式协作。
6. 评审期间保持启动机器上的 Echo 服务运行。

## 数据存储

运行数据保存在本地：

```text
data/store.json
data/docs/
```

这些文件默认不会进入 Git。URL 快照也会保存在 `data/docs/` 下面。

## AI 设置

AI 补足需求会使用首页配置的：

- OpenAI 兼容 Base URL
- 模型名
- API Key

生成的需求语言会跟随当前界面语言。

## 排查问题

如果同事打不开评审链接：

- 确认启动机器上的 Echo 还在运行。
- 分享局域网或 VPN IP 链接，不要分享 `localhost`。
- 确认大家在同一个局域网或 VPN。
- 检查启动机器防火墙是否允许访问 `5177` 端口。
- 检查 `5177` 端口是否被其他进程占用。

如果端口卡住，可以使用 `startup-methods/` 里的停止脚本。

## 打包

项目里带有 `pkg` 打包脚本：

```sh
npm run build
```

打包结果会输出到 `bin/`。可执行文件会比较大，因为里面包含 Node.js 运行时。
