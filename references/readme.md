# 参考资料目录
当前目录存放该项目期间，需要借鉴、参考的资料、开源项目源码、各类信息等等文件；

## 维护声明
该目录下，每次新增文件夹、文件之类的，要在当前文件中进行简单介绍维护，方便后续参考、跟踪。


## 文件目录说明

- `ipmsg/`：IP Messenger 官方源码（Windows 版，C++）。重点参考：`protocol.txt`（日文协议原文）、`prot-eng.txt`（英文协议说明），是 UDP 发现 / 消息、TCP 文件传输这套模型的鼻祖。克隆自 <https://github.com/shirouzu/ipmsg>（不入 git，本地自行克隆）。
- `iptux/`：Linux 下的 ipmsg 兼容实现（GTK，C++）。重点参考：`protocol/` 目录下的协议整理，以及 `src/` 中 UDP 发现与 TCP 传输的工程实现。克隆自 <https://github.com/iptux-src/iptux>（不入 git，本地自行克隆）。
