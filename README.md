# 中国象棋多人房间

一个适配手机和桌面浏览器的实时中国象棋网页。玩家通过同一邀请链接进入房间，可选择红方、黑方或观战；双方锁定后开始棋局。

## 功能

- 标准九路十线中国象棋棋盘与完整走子规则
- 红黑选边、锁定开局、邀请链接和观众模式
- 将军、将杀和自陷将军校验
- 当前行棋方、上一步和棋谱显示
- 双方同意后悔棋、求和，以及主动认输
- 按身份显示获胜、失败或观战终局提示
- 房间无人访问后自动关闭
- SQLite 棋局持久化
- macOS 一键启动、关闭及 cpolar 中国区公网穿透

## 环境要求

- Node.js 24 或更高版本（使用内置 `node:sqlite`）
- macOS 一键穿透功能需要已安装并登录的 [cpolar](https://www.cpolar.com/)

## 本地运行

```bash
npm start
```

打开 `http://localhost:3000`。数据默认保存在 `data/xiangqi.sqlite`。

运行测试：

```bash
npm test
```

## macOS 一键运行

Finder 中双击 `启动象棋.command`。脚本会安装并启动 launchd 服务、连接 cpolar 中国区隧道，并弹出当前公网网址。双击 `关闭象棋.command` 可停止网页服务和隧道。

cpolar 免费随机域名可能在重连后变化。主机需要保持开机联网，公网用户才能访问。

## 技术结构

- `public/`：无框架浏览器界面与象棋规则引擎
- `server.js`：Node HTTP API、多人房间和 SQLite 持久化
- `tests/`：开局布局、走棋规则、悔棋和房间生命周期测试
- `deploy/local/`：macOS launchd 配置模板
