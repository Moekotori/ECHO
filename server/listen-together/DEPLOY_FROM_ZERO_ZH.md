# Listen Together 服务器从零部署教程（Debian）

本教程面向完全从零开始的同学，按步骤操作即可把 `listen-together` 服务部署上线。

适用代码目录：`server/listen-together`  
系统：`Debian 12`（Debian 11 也基本一致）

---

## 0. 你将得到什么

完成后你会获得：

- 一个可公网访问的 listen-together 服务（默认端口 `8787`）
- 支持房间创建/加入、播放状态同步、本地文件上传拉流
- 可选 token 鉴权
- PM2 守护 + 开机自启
- 可选 Nginx 反代 + HTTPS

---

## 1. 购买服务器（必须）

可选云厂商：阿里云、腾讯云、华为云、AWS、GCP 等。

建议配置（小规模测试）：

- CPU：`2 vCPU`
- 内存：`2 GB`（推荐 `4 GB` 更稳）
- 磁盘：`40 GB` SSD
- 系统盘镜像：`Debian 12`
- 公网带宽：`3 Mbps` 起步（多人听歌建议更高）

购买时记录：

- 公网 IP（例如 `223.x.x.x`）
- root 密码或 SSH 密钥

---

## 2. 开放安全组端口（必须）

在云控制台安全组/防火墙里放行入站：

- `22/tcp`（SSH）
- `8787/tcp`（listen-together 直连）
- `80/tcp`（Nginx HTTP，可选）
- `443/tcp`（HTTPS，可选）

---

## 3. 用 SSH 连接服务器（必须）

在本机终端执行：

```bash
ssh root@你的公网IP
```

首次会提示指纹，输入 `yes`。

---

## 4. 系统初始化（建议但强烈推荐）

### 4.1 更新系统

```bash
apt update && apt -y upgrade
```

### 4.2 安装常用工具

```bash
apt -y install curl git unzip ufw
```

### 4.3 设置时区（可选）

```bash
timedatectl set-timezone Asia/Shanghai
timedatectl
```

### 4.4 防火墙（UFW）

```bash
ufw allow 22/tcp
ufw allow 8787/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

---

## 5. 安装 Node.js 20 LTS（必须）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v
npm -v
```

预期：`node -v` 输出 `v20.x`。

---

## 6. 准备服务文件（必须）

你需要服务器上有 `server/listen-together` 目录，至少包含：

- `index.js`
- `roomStore.js`
- `mediaStore.js`
- `auth.js`
- `package.json`
- `ecosystem.config.cjs`

### 方式 A：用 git 拉代码（推荐）

```bash
cd /opt
git clone 你的项目仓库地址 echo-app
cd /opt/echo-app/server/listen-together
```

### 方式 B：本地上传目录

把本地 `server/listen-together` 上传到服务器某路径（如 `/opt/echo-app/server/listen-together`）。

---

## 7. 安装依赖并首次启动（必须）

```bash
cd /opt/echo-app/server/listen-together
npm install
PORT=8787 npm start
```

看到日志：

```text
[listen-together] server running on :8787
```

说明启动成功。

按 `Ctrl + C` 停止，进入下一步守护运行。

---

## 8. 使用 PM2 守护运行（推荐）

### 8.1 安装 PM2

```bash
npm i -g pm2
```

### 8.2 启动服务

```bash
cd /opt/echo-app/server/listen-together
pm2 start ecosystem.config.cjs
pm2 ls
```

预期进程名：`echo-listen-together`。

### 8.3 查看日志

```bash
pm2 logs echo-listen-together --lines 100
```

### 8.4 开机自启

```bash
pm2 startup
```

执行它输出的那一条命令（通常是 `sudo env PATH=... pm2 startup systemd -u root --hp /root`）。

然后：

```bash
pm2 save
```

---

## 9. 健康检查与公网验证（必须）

### 9.1 本机（服务器内）检查

```bash
curl http://127.0.0.1:8787/health
```

预期返回：

```json
{"ok":true,"service":"listen-together","now":...}
```

### 9.2 外部机器检查

在你的本地电脑执行：

```bash
curl http://你的公网IP:8787/health
```

若超时，优先排查：

- 云安全组是否放行 `8787/tcp`
- UFW 是否放行 `8787/tcp`
- PM2 进程是否在线

---

## 10. 客户端如何填写连接信息（必须）

在 ECHO 的 Listen Together 抽屉中：

- 服务器地址填：`http://你的公网IP:8787`
- 如果你配置了 token，则在“访问令牌”填同一个 token
- 锁房时，成员需要正确的房间访问 key 才能加入

---

## 11. 配置 token 鉴权（可选，推荐公网）

服务支持环境变量 `LISTEN_TOGETHER_TOKEN`。

临时运行示例：

```bash
cd /opt/echo-app/server/listen-together
LISTEN_TOGETHER_TOKEN="your_strong_token_here" PORT=8787 npm start
```

PM2 持久化方式（编辑 `ecosystem.config.cjs` 的 `env`）：

```js
env: {
  NODE_ENV: 'production',
  PORT: 8787,
  LISTEN_TOGETHER_TOKEN: 'your_strong_token_here'
}
```

改完后重启：

```bash
pm2 restart echo-listen-together
```

客户端需要填同 token 才能上传/拉流。

---

## 12. Nginx 反向代理（可选，推荐）

## 12.1 安装 Nginx

```bash
apt -y install nginx
```

## 12.2 新建站点配置

```bash
cat >/etc/nginx/sites-available/listen-together.conf <<'EOF'
server {
  listen 80;
  server_name 你的域名;

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
EOF
```

启用配置：

```bash
ln -sf /etc/nginx/sites-available/listen-together.conf /etc/nginx/sites-enabled/listen-together.conf
nginx -t
systemctl restart nginx
systemctl status nginx --no-pager
```

此时客户端地址可写为：`http://你的域名/listen`

---

## 13. HTTPS（可选）

如果你有域名，推荐启用证书：

```bash
apt -y install certbot python3-certbot-nginx
certbot --nginx -d 你的域名
```

完成后客户端地址改为：

- `https://你的域名/listen`

---

## 14. 更新代码后的正确流程（很重要）

每次你本地改了 `server/listen-together` 并同步到 Debian 后，务必：

```bash
cd /opt/echo-app/server/listen-together
npm install
pm2 restart echo-listen-together
pm2 logs echo-listen-together --lines 80
```

如果忘记重启，客户端会表现为“功能没生效”。

---

## 15. 常见问题排障

### Q1: `EADDRINUSE: address already in use :::8787`

端口被占用：

```bash
ss -lntp | grep 8787
```

结束占用进程后再启动，或改端口。

### Q2: 本机 `127.0.0.1` 通，公网不通

- 安全组没开 `8787/tcp`
- UFW 没开 `8787/tcp`
- 云厂商网络 ACL 阻断

### Q3: 能连上但加入房间失败

- 房间码错误
- 房间开启了 `lockByKey` 但 key 不正确（会报 `room_locked`）
- token 不匹配（会报 `unauthorized`）

### Q4: 更新后功能没变化

- 服务器代码没同步
- PM2 没重启
- 客户端连接到旧地址

### Q5: 上传本地文件失败

- token 未填写或错误
- 文件过大（当前默认上限 200MB）
- 磁盘空间不足

---

## 16. 最短上线路径（10 分钟版）

```bash
# 1) 安装 Node
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs git

# 2) 拉代码
cd /opt
git clone 你的仓库 echo-app
cd /opt/echo-app/server/listen-together

# 3) 启动
npm install
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save

# 4) 放行端口（云安全组 + ufw）
ufw allow 8787/tcp
ufw enable

# 5) 验证
curl http://127.0.0.1:8787/health
```

客户端填：`http://公网IP:8787`

---

## 17. 生产推荐路径

- 域名 + Nginx + HTTPS
- 开启 `LISTEN_TOGETHER_TOKEN`
- PM2 守护 + 开机自启
- 定期更新系统与 Node LTS
- 定时清理日志与监控磁盘

