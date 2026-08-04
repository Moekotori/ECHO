# ECHO Pro Cloud 宝塔部署教程

这个目录包含可公开的服务端源码。请勿把密码、令牌、数据库或其他运行时凭据提交到 GitHub。

## 0. 先做安全处理

你之前把 root 密码发到聊天里了，按安全标准要当作已经泄露处理。

部署前或部署后都可以，但越早越好：

1. 宝塔或 SSH 登录服务器。
2. 在宝塔面板里修改 root 密码，或 SSH 执行：

```bash
passwd root
```

3. 建议后面改用 SSH Key 登录，并在确认 Key 可用后关闭 SSH 密码登录。

## 1. 确认宝塔环境

在宝塔面板里确认：

- 网站已经绑定 `echonext.moe`
- 已经开启 HTTPS/SSL
- Nginx 正在运行
- 服务器能 SSH 登录

在 SSH 里确认 Node.js：

```bash
node -v
```

建议 Node.js 20+。如果没有 Node，可以用宝塔的软件商店安装 Node.js，或用系统包管理器安装。

## 2. 上传部署包

当前本机部署包：

```text
<PROJECT_ROOT>\private\echo-pro-cloud\echo-pro-cloud-deploy.zip
```

推荐方式 A：宝塔文件管理器上传

1. 打开宝塔面板。
2. 进入“文件”。
3. 进入 `/root`。
4. 上传 `echo-pro-cloud-deploy.zip`。
5. 在宝塔里解压到 `/root/echo-pro-cloud`。

如果宝塔解压到了别的目录，最后确保服务器上有：

```text
/root/echo-pro-cloud/server.mjs
/root/echo-pro-cloud/install-on-server.sh
/root/echo-pro-cloud/echo-pro-cloud.service
/root/echo-pro-cloud/nginx-location.conf
```

方式 B：本机 PowerShell 上传

```powershell
scp <PROJECT_ROOT>/private/echo-pro-cloud/echo-pro-cloud-deploy.zip root@<YOUR_SERVER_IP>:/root/
```

然后 SSH 到服务器：

```bash
cd /root
rm -rf echo-pro-cloud
mkdir -p echo-pro-cloud
unzip -o echo-pro-cloud-deploy.zip -d echo-pro-cloud
```

## 3. 安装 ECHO Pro 云端服务

SSH 执行：

```bash
cd /root/echo-pro-cloud
chmod +x ./install-on-server.sh
bash ./install-on-server.sh
```

这个脚本会做这些事：

- 把 `server.mjs` 安装到 `/opt/echo-pro-cloud/server.mjs`
- 创建系统用户 `echo-pro`
- 创建数据库目录 `/var/lib/echo-pro`
- 创建 `/etc/echo-pro-cloud.env`
- 自动生成 `ECHO_PRO_ADMIN_TOKEN`
- 自动生成 `ECHO_PRO_KEY_PEPPER`
- 安装 systemd 服务 `echo-pro-cloud.service`
- 启动服务并设置开机自启

查看环境变量：

```bash
cat /etc/echo-pro-cloud.env
```

这里面的 `ECHO_PRO_ADMIN_TOKEN` 是管理员密钥，只能自己保存，不能发 GitHub。

## 4. 检查 systemd 服务

```bash
systemctl status --no-pager echo-pro-cloud.service
```

正常应该看到 `active (running)`。

查看实时日志：

```bash
journalctl -u echo-pro-cloud.service -f
```

本机回环测试：

```bash
curl -sS http://127.0.0.1:8787/health
```

正常会返回 JSON。

## 5. 宝塔配置 Nginx 反代

打开宝塔：

1. 网站
2. 找到 `echonext.moe`
3. 设置
4. 配置文件
5. 找到当前 HTTPS 的 `server { ... }` 配置块
6. 把 `/root/echo-pro-cloud/nginx-location.conf` 里的全部 `location` 粘贴到这个 `server { ... }` 里面

注意：必须放在 `server {}` 内部，不要放到文件最外层。

可以在服务器 SSH 查看要粘贴的内容：

```bash
cat /root/echo-pro-cloud/nginx-location.conf
```

重点确认这一段存在，因为云端同步歌单可能超过 1MB：

```nginx
location = /api/echo-pro/settings/cloud {
  limit_except GET PUT { deny all; }
  client_max_body_size 8m;
  proxy_pass http://127.0.0.1:8787/api/echo-pro/settings/cloud;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 10s;
}
```

保存后在 SSH 检查：

```bash
nginx -t
```

如果显示 successful，再重载：

```bash
systemctl reload nginx
```

宝塔面板里也可以点“保存”或“重载配置”，但 SSH 的 `nginx -t` 更稳。

## 6. 外网测试接口

```bash
curl -sS https://echonext.moe/api/echo-pro/health
```

正常会返回健康状态 JSON。

再测试注册接口是否能走到服务端：

```bash
curl -i https://echonext.moe/api/echo-pro/auth/register
```

因为这里没有用 POST，返回 `405` 是正常的，说明 Nginx 路由已经到位。

如果返回宝塔默认 404 或 HTML 页面，说明 location 没放对位置。

## 7. 创建/授权 Pro 账号

先读取管理员 token：

```bash
source /etc/echo-pro-cloud.env
echo "$ECHO_PRO_ADMIN_TOKEN"
```

注册推荐让用户用 QQ 号作为账号。

如果用户已经在客户端注册了账号，比如 `2331103944`，给它开 Pro：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/users \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"2331103944","pro":true}'
```

解绑这个账号全部设备：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/users \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"2331103944","resetMachines":true}'
```

关闭账号：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/users \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"2331103944","status":"disabled"}'
```

## 8. 生成 ECHO Pro Key

生成 5 个一次性 Key：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/keys \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"count":5,"maxRedemptions":1,"note":"manual batch"}'
```

返回里的 `key` 只显示一次。发给用户后不要把原始 Key 存进公开仓库。

如果要生成 1 个 Key：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/keys \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"count":1,"maxRedemptions":1,"note":"single user"}'
```

## 9. 客户端测试流程

在 ECHO 客户端：

1. 设置
2. 通用
3. ECHO Pro 账号
4. 展开
5. 账号填 QQ 号
6. 密码至少 8 位
7. 点击注册
8. 服务器后台给这个账号开 Pro，或让用户兑换 Key
9. 客户端点击检查

如果显示 Pro 已启用，就可以测试：

- 窗口亚克力 Pro Only
- 插件 Pro Only
- 网盘/远程源 Pro Only
- 云端保存设置
- 从云端同步
- 账号最多 2 台设备
- 解绑所有设备

## 10. 云端同步说明

云端同步会保存：

- ECHO 设置
- 网络歌单
- 流媒体收藏

云端同步不会保存：

- 网易云 Cookie
- QQ 音乐 Cookie
- Spotify 登录态
- 任何第三方账号密码
- 本地音乐文件
- 本地手动歌单

所以另一台设备同步后，歌单会出现，但如果播放某个平台需要账号权限，用户要先在 ECHO 的账号设置里登录对应平台。

## 11. 常见问题

### 客户端注册提示 405

常见原因：

- Nginx 里没加 `/api/echo-pro/auth/register`
- location 没放进 `echonext.moe` 的 HTTPS `server {}` 内
- 修改配置后没有 `nginx -t` 和 reload

检查：

```bash
nginx -t
systemctl reload nginx
curl -i https://echonext.moe/api/echo-pro/auth/register
```

GET 返回 405 正常；客户端 POST 不应该再 405。

### 云端同步歌单失败或 413

这是请求体太大。

确认 Nginx location 有：

```nginx
client_max_body_size 8m;
```

确认 `/etc/echo-pro-cloud.env` 有：

```bash
ECHO_PRO_MAX_REQUEST_BODY_BYTES=8388608
```

修改后重启：

```bash
systemctl restart echo-pro-cloud.service
nginx -t
systemctl reload nginx
```

### Pro 检查失败

查看服务日志：

```bash
journalctl -u echo-pro-cloud.service -n 100 --no-pager
```

确认服务端运行：

```bash
systemctl status --no-pager echo-pro-cloud.service
curl -sS http://127.0.0.1:8787/health
```

确认外网路由：

```bash
curl -sS https://echonext.moe/api/echo-pro/health
```

### 账号登录第三台设备失败

这是正常的，默认一个账号最多 2 台设备。

用户可以在已登录设备里点“解绑所有设备”，或管理员执行：

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/users \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"2331103944","resetMachines":true}'
```

## 12. 更新服务端

以后本地重新生成 `echo-pro-cloud-deploy.zip` 后：

1. 上传新 zip 到 `/root`
2. 解压到 `/root/echo-pro-cloud`
3. 执行：

```bash
cd /root/echo-pro-cloud
bash ./install-on-server.sh
systemctl restart echo-pro-cloud.service
nginx -t
systemctl reload nginx
curl -sS https://echonext.moe/api/echo-pro/health
```

`install-on-server.sh` 不会覆盖已有 `/etc/echo-pro-cloud.env`，所以管理员 token 和 pepper 会保留。
