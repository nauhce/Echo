# 启动方式

这个文件夹保存 Echo 的本地启动文件。

## Windows

启动建议使用 `windows-echo.bat`。它会打开可见命令行窗口，检查 Node.js，然后启动 Echo。

日常启动可以使用 `windows-echo-hidden.vbs`。它会无黑框启动 Echo。

如果要停止服务，使用 `windows-echo-stop.bat`。它会停止占用 `5177` 端口的 Echo 进程。

Windows 的 `.bat` 文件刻意使用英文提示，避免不同系统语言和编码下出现乱码后导致命令被错误解析。

## macOS

启动使用 `macos-echo.command`。它会检查 Node.js，然后启动 Echo。

停止服务使用 `macos-echo-stop.command`。它会停止占用 `5177` 端口的 Echo 进程。

macOS 下载或解压项目后，需要在项目根目录执行一次：

```sh
chmod +x startup-methods/macos-echo.command startup-methods/macos-echo-stop.command
```

## 启动后访问

打开：

```text
http://localhost:5177
```

如果浏览器没有自动打开，把这个地址手动复制到浏览器即可。

## 前置要求

Windows 和 macOS 用户都需要先安装 Node.js。Echo 正常启动不需要执行 `npm install`：

```text
https://nodejs.org/
```
