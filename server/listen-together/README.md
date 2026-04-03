# Listen Together Server

`Debian` 上用于“一起听歌”首版的控制与媒体分发服务。

## 从零部署教程（推荐先看）

- 详细步骤（从购买服务器开始）：[`DEPLOY_FROM_ZERO_ZH.md`](./DEPLOY_FROM_ZERO_ZH.md)
- 适合新手，包含命令、预期结果和故障排查。

## 功能

- WebSocket 房间控制（创建/加入/状态广播）
- 在线直链音频共享
- 本地文件分片上传后的临时流播放
- 轻量 token 鉴权（可选）

## 快速部署（Debian）

```bash
cd server/listen-together
npm install
PORT=8787 npm start
```

## 环境变量

- `PORT`：监听端口，默认 `8787`
- `LISTEN_TOGETHER_TOKEN`：可选，若设置则 HTTP 接口需传 `x-listen-token`

## Nginx 反代示例

```nginx
server {
  listen 80;
  server_name your.domain;

  location /listen/ws {
    proxy_pass http://127.0.0.1:8787/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location /listen/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_set_header Host $host;
  }
}
```

## PM2 启动

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

## 协议（首版）

- `hello`：服务端下发连接标识
- `room:create`：创建房间
- `room:join`：加入房间
- `room:state`：房间全量状态
- `room:presence`：成员变化广播
- `player:update`：房主播放状态更新
- `media:publish`：房主发布可播放音频地址
- `ping` / `pong`：心跳与时钟校准
