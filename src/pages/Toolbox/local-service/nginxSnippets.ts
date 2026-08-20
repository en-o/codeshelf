export interface NginxSnippet {
  category: string;
  title: string;
  description: string;
  code: string;
}

export const NGINX_MANUAL_TEMPLATE = `# nginx 配置手册草稿
# 这里可以从左侧插入常用片段，组合成自己的 conf。

server {
    listen 80;
    server_name localhost;
    charset utf-8;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
        try_files $uri $uri/ =404;
    }
}
`;

export const NGINX_SNIPPETS = [
  {
    category: "基础",
    title: "基础 Server",
    description: "最小可运行 server 块",
    code: `server {
    listen 80;
    server_name example.com;
    charset utf-8;
}`,
  },
  {
    category: "静态站点",
    title: "静态目录",
    description: "root + try_files",
    code: `root /var/www/html;
index index.html index.htm;

location / {
    autoindex on;
    autoindex_exact_size off;
    autoindex_localtime on;
    try_files $uri $uri/ =404;
}`,
  },
  {
    category: "静态站点",
    title: "SPA 回退",
    description: "Vue / React 前端路由刷新不 404",
    code: `location / {
    try_files $uri $uri/ /index.html;
}`,
  },
  {
    category: "静态站点",
    title: "路径前缀",
    description: "alias 挂载子路径",
    code: `location /app/ {
    alias /var/www/app/;
    index index.html;
    try_files $uri $uri/ /app/index.html;
}`,
  },
  {
    category: "代理",
    title: "API 代理",
    description: "反向代理到后端",
    code: `location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}`,
  },
  {
    category: "代理",
    title: "透传前缀",
    description: "后端保留原始访问前缀",
    code: `location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Prefix /api;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}`,
  },
  {
    category: "代理",
    title: "WebSocket",
    description: "升级连接头",
    code: `location /ws/ {
    proxy_pass http://127.0.0.1:3000/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}`,
  },
  {
    category: "跨域",
    title: "CORS",
    description: "跨域与预检",
    code: `add_header Access-Control-Allow-Origin * always;
add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization" always;

if ($request_method = OPTIONS) {
    return 204;
}`,
  },
  {
    category: "性能",
    title: "Gzip",
    description: "文本资源压缩",
    code: `gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types
    text/plain
    text/css
    application/json
    application/javascript
    text/xml
    application/xml
    image/svg+xml;`,
  },
  {
    category: "性能",
    title: "缓存策略",
    description: "静态资源长缓存",
    code: `location ~* \\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}`,
  },
  {
    category: "限制",
    title: "上传大小",
    description: "放开请求体限制",
    code: `client_max_body_size 50m;`,
  },
  {
    category: "限制",
    title: "响应超时",
    description: "接口或文件下载超时配置",
    code: `proxy_connect_timeout 60s;
proxy_send_timeout 120s;
proxy_read_timeout 120s;
send_timeout 120s;`,
  },
  {
    category: "日志",
    title: "日志",
    description: "访问和错误日志",
    code: `access_log /var/log/nginx/app_access.log;
error_log /var/log/nginx/app_error.log warn;`,
  },
  {
    category: "日志",
    title: "站点访问量",
    description: "自定义日志格式，便于统计来源",
    code: `log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                '$status $body_bytes_sent "$http_referer" '
                '"$http_user_agent" "$http_x_forwarded_for"';

access_log /var/log/nginx/access.log main;`,
  },
  {
    category: "安全",
    title: "HTTPS",
    description: "证书配置骨架",
    code: `listen 443 ssl http2;
server_name example.com;

ssl_certificate /etc/nginx/certs/example.com.pem;
ssl_certificate_key /etc/nginx/certs/example.com.key;
ssl_protocols TLSv1.2 TLSv1.3;`,
  },
  {
    category: "安全",
    title: "HTTP 自动跳 HTTPS",
    description: "80 端口统一跳转到 443",
    code: `server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}`,
  },
  {
    category: "安全",
    title: "禁止访问隐藏文件",
    description: "拦截 .env、.git 等敏感文件",
    code: `location ~ /\\. {
    deny all;
    access_log off;
    log_not_found off;
}`,
  },
  {
    category: "安全",
    title: "防止跨站脚本",
    description: "常用安全响应头",
    code: `add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy strict-origin-when-cross-origin always;`,
  },
  {
    category: "安全",
    title: "Basic Auth",
    description: "nginx 登录认证",
    code: `location /admin/ {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:8080/;
}`,
  },
  {
    category: "重定向",
    title: "带参数重定向",
    description: "保留 query string",
    code: `location /old/ {
    return 301 /new/$is_args$args;
}`,
  },
  {
    category: "重定向",
    title: "不带参数重定向",
    description: "固定跳转到新地址",
    code: `location = /old {
    return 302 /new;
}`,
  },
  {
    category: "负载均衡",
    title: "上游服务",
    description: "多个后端轮询",
    code: `upstream app_backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

location /api/ {
    proxy_pass http://app_backend/;
}`,
  },
  {
    category: "TCP Stream",
    title: "MySQL 转发",
    description: "stream 块，放在 http 外层",
    code: `stream {
    upstream mysql_backend {
        server 127.0.0.1:3306;
    }

    server {
        listen 13306;
        proxy_pass mysql_backend;
    }
}`,
  },
  {
    category: "TCP Stream",
    title: "Redis 转发",
    description: "stream 块，放在 http 外层",
    code: `stream {
    upstream redis_backend {
        server 127.0.0.1:6379;
    }

    server {
        listen 16379;
        proxy_pass redis_backend;
    }
}`,
  },
  {
    category: "对象存储",
    title: "MinIO 独立域名",
    description: "API 和控制台分域名代理",
    code: `server {
    listen 80;
    server_name minio.example.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name minio-console.example.com;

    location / {
        proxy_pass http://127.0.0.1:9001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`,
  },
  {
    category: "对象存储",
    title: "MinIO 非独立域名",
    description: "通过路径前缀访问",
    code: `location /minio/ {
    proxy_pass http://127.0.0.1:9000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location /minio-console/ {
    proxy_pass http://127.0.0.1:9001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}`,
  },
  {
    category: "IPv6",
    title: "同时监听 IPv4 和 IPv6",
    description: "双栈监听",
    code: `listen 80;
listen [::]:80;
server_name example.com;`,
  },
  {
    category: "IPv6",
    title: "只监听 IPv6",
    description: "仅 IPv6 地址",
    code: `listen [::]:80 ipv6only=on;
server_name example.com;`,
  },
  {
    category: "排错",
    title: "failed (13: Permission denied)",
    description: "静态目录权限排查参考",
    code: `# 检查 nginx worker 用户是否能访问目录每一级父路径
# namei -l /path/to/site
# chmod o+x /path /path/to /path/to/site
# chown -R nginx:nginx /path/to/site

user nginx;`,
  },
  {
    category: "排错",
    title: "清空 nginx 缓存",
    description: "proxy_cache 场景",
    code: `proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:100m inactive=60m;

location /api/ {
    proxy_cache app_cache;
    proxy_cache_valid 200 10m;
    proxy_pass http://127.0.0.1:3000/;
}

# 清理缓存目录
# rm -rf /var/cache/nginx/*`,
  },
  {
    category: "应用",
    title: "Spring Boot Admin",
    description: "反代 Spring Boot Admin 和 websocket",
    code: `location /admin/ {
    proxy_pass http://127.0.0.1:8080/admin/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Prefix /admin;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /admin/instances/ {
    proxy_pass http://127.0.0.1:8080/admin/instances/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}`,
  },
  {
    category: "应用",
    title: "Nexus HTTPS",
    description: "Nexus 仓库代理",
    code: `location /repository/ {
    proxy_pass http://127.0.0.1:8081/repository/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 2g;
}`,
  },
  {
    category: "应用",
    title: "Nacos 配置",
    description: "Nacos 控制台路径代理",
    code: `location /nacos/ {
    proxy_pass http://127.0.0.1:8848/nacos/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}`,
  },
  {
    category: "应用",
    title: "Apollo 配置中心",
    description: "Apollo Portal 代理",
    code: `location /apollo/ {
    proxy_pass http://127.0.0.1:8070/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Prefix /apollo;
}`,
  },
  {
    category: "部署",
    title: "多个 conf 配置文件",
    description: "主配置 include",
    code: `http {
    include       mime.types;
    default_type  application/octet-stream;

    include /etc/nginx/conf.d/*.conf;
}`,
  },
  {
    category: "部署",
    title: "Docker 使用 nginx",
    description: "挂载配置和静态目录",
    code: `docker run -d --name nginx-app \\
  -p 80:80 \\
  -v /path/site:/usr/share/nginx/html:ro \\
  -v /path/app.conf:/etc/nginx/conf.d/default.conf:ro \\
  nginx:stable`,
  },
  {
    category: "部署",
    title: "OpenResty 隐藏版本号",
    description: "减少版本暴露",
    code: `server_tokens off;

more_clear_headers Server;`,
  },
  {
    category: "性能",
    title: "优化文件传输",
    description: "sendfile 与连接保持",
    code: `sendfile on;
tcp_nopush on;
tcp_nodelay on;
keepalive_timeout 65;
types_hash_max_size 2048;`,
  },
] satisfies NginxSnippet[];
