// 内网穿透「使用说明」应用内弹窗：怎么操作、服务器怎么配、nginx 怎么配、当前配置怎么套。
// 从内网穿透页头部的「使用说明」按钮打开。

import type { ReactNode } from "react";
import { BookOpen, Copy, X } from "lucide-react";
import { showToast } from "@/components/ui";

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-gray-950 px-3 py-2.5 pr-10 text-xs leading-5 text-gray-100">
        {code}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            showToast("success", "已复制");
          } catch {
            /* ignore */
          }
        }}
        className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
        title="复制"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
      <div className="space-y-2 text-[13px] leading-6 text-gray-600 dark:text-gray-300">{children}</div>
    </section>
  );
}

export function ReverseTunnelHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 top-8 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-orange-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">内网穿透 · 使用说明</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <Section title="这是什么 / 需要准备什么">
            <p>
              通过 SSH「反向隧道」把你本地的服务，临时映射到你**自己 VPS** 的一个公网端口——
              等价 <code className="font-mono">ssh -N -R 绑定:公网端口:本地主机:本地端口 用户@VPS</code>。
              典型用途：微信/支付回调只能填外网域名，本地服务收不到时用它打通。
            </p>
            <p>
              需要一台<b>能 SSH 登录、带公网 IP（最好有域名）</b>的服务器（阿里云 / 腾讯云 ECS 都可以）。
              真正的 P2P 无法接收第三方回调，所以必须有这么个"公网入口"。
            </p>
          </Section>

          <Section title="三步走">
            <p>
              1）在 VPS 上配一次 <code className="font-mono">GatewayPorts</code>（下方第 1 步）→
              2）在云控制台放行端口（第 2 步）→
              3）回到本工具填好映射、点「启动」。任一步没通，外网就连不上。
            </p>
          </Section>

          <Section title="① 服务器配置：开启 GatewayPorts（一次性）">
            <p>
              它决定反向隧道在 VPS 上监听哪个地址：<code className="font-mono">no</code>（默认，只绑本机、外网连不上）、
              <code className="font-mono">yes</code>（绑所有网卡）、
              <code className="font-mono">clientspecified</code>（听本工具的——推荐）。
              本工具会把你勾选的绑定地址明确发给服务端，用 <code className="font-mono">clientspecified</code> 最精准安全。
            </p>
            <CodeBlock
              code={`# 在 VPS 上执行
sudo vim /etc/ssh/sshd_config
# 找到 GatewayPorts（没有就新增一行），改成：
GatewayPorts clientspecified

# 重启 sshd（不会断开你当前的 SSH 连接）
sudo systemctl restart sshd      # Ubuntu/Debian 可能叫 ssh: sudo systemctl restart ssh

# 确认生效
sudo sshd -T | grep gatewayports # 应输出 gatewayports clientspecified`}
            />
          </Section>

          <Section title="② 云服务器放行端口（阿里云 / 腾讯云 ECS）">
            <p>
              云主机的公网端口默认被<b>安全组</b>挡着，光配 GatewayPorts 还不够，必须在控制台放行你要用的端口（如 9000）：
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>阿里云</b>：ECS 控制台 → 实例 → 安全组 → 配置规则 → <b>入方向</b> → 手动添加：协议 TCP、端口 9000、授权对象 <code className="font-mono">0.0.0.0/0</code>（或微信回调 IP 段）。</li>
              <li><b>腾讯云</b>：CVM 控制台 → 安全组 → 入站规则 → 添加，同样填端口与来源。</li>
            </ul>
            <p>如果实例内还开了防火墙（ufw / firewalld），也要放行：</p>
            <CodeBlock
              code={`# Ubuntu 启用了 ufw 时
sudo ufw allow 9000/tcp

# CentOS / firewalld
sudo firewall-cmd --add-port=9000/tcp --permanent && sudo firewall-cmd --reload`}
            />
          </Section>

          <Section title="③ 本工具怎么填（以「本机 8080 → 公网 9000」为例）">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>本地服务</b>：本地主机 <code className="font-mono">127.0.0.1</code>、本地端口 <code className="font-mono">8080</code>（你本地实际在跑的服务）。</li>
              <li><b>SSH 服务器</b>：填 VPS 的地址 / 端口 / 用户，选私钥或密码认证。</li>
              <li><b>公网映射</b>：公网端口 <code className="font-mono">9000</code>；可选填域名（只影响展示的公网地址）。</li>
              <li>
                <b>对公网开放</b>：勾了=绑 <code className="font-mono">0.0.0.0</code>（外网直连，需上面的 GatewayPorts+安全组）；
                不勾=绑 <code className="font-mono">127.0.0.1</code>（只 VPS 本机可达，配 nginx 反代，<b>更推荐</b>）。
              </li>
            </ul>
            <p>启动后列表里的「公网地址」就是填给微信回调的地址：<code className="font-mono">http://域名或VPS_IP:9000</code>。</p>
          </Section>

          <Section title="④ 推荐姿势：nginx 反代 + HTTPS（更安全，微信也要求 HTTPS）">
            <p>
              工具里<b>不勾</b>「对公网开放」（只绑 <code className="font-mono">127.0.0.1:9000</code>），由 VPS 的 nginx 对外提供 443 + 证书，
              只暴露具体回调路径，反代到本机 9000：
            </p>
            <CodeBlock
              code={`server {
    listen 443 ssl;
    server_name dev.example.com;
    ssl_certificate     /etc/letsencrypt/live/dev.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dev.example.com/privkey.pem;

    location /wechat/callback {        # 只暴露这一个回调路径，攻击面最小
        # allow 微信回调IP段;          # 需要时按官方公布 IP 段填
        # deny all;
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`}
            />
            <p>这样公网只暴露 <code className="font-mono">https://dev.example.com/wechat/callback</code>，隧道本身不直接对公网开放。</p>
          </Section>

          <Section title="⑤ 关于鉴权（重要）">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300">
              <p className="font-medium">被映射的本地服务自身没有鉴权，公网任何人可达，请只用于临时调试、用完即停。</p>
            </div>
            <p><b>坑：</b>微信回调是微信服务器主动来调你，不会带账号密码，所以给隧道加 HTTP Basic Auth 会把<b>微信自己也挡在门外</b>。Basic Auth 只适合保护你自己看的后台页面，不适合 webhook。</p>
            <p>针对回调，正确的做法（可叠加）：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>平台验签（最重要）</b>：在你本地回调代码里用微信的 <code className="font-mono">signature/timestamp/nonce/token</code> 验签，非法请求直接拒——这才是 webhook 真正的安全边界。</li>
              <li><b>只映射本机 + nginx 只暴露具体路径</b>（第 ④ 步）。</li>
              <li><b>IP 白名单</b>：nginx <code className="font-mono">allow/deny</code> 或安全组只放行微信公开的回调 IP 段。</li>
              <li>用<b>难猜的高位端口 / 随机路径</b>降低被扫概率。</li>
            </ul>
            <p>若暴露的是<b>你自己用的后台</b>（非第三方回调），可大胆用 nginx Basic Auth 或 IP 白名单。</p>
          </Section>

          <Section title="⑥ 如何关闭">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>临时关（最常用）</b>：工具里点「停止」，VPS 上那个端口立刻不再监听。</li>
              <li><b>收回服务端能力</b>：把 <code className="font-mono">GatewayPorts</code> 改回 <code className="font-mono">no</code> 后 <code className="font-mono">sudo systemctl restart sshd</code>。</li>
              <li><b>云端</b>：删掉安全组里为该端口开的入方向规则。</li>
            </ul>
          </Section>

          <Section title="⑦ 连不上？按这个查">
            <ul className="list-disc space-y-1 pl-5">
              <li>启动即报「请求远端端口转发失败」：端口被占用，或对公网开放却没配 <code className="font-mono">GatewayPorts</code>，换端口或改配置。</li>
              <li>一直「重连中」：SSH 连不上，核对主机/端口/用户/私钥，确认 VPS 放行了 22。</li>
              <li>VPS 本机 curl 通、外网不通：没配 <code className="font-mono">GatewayPorts</code>，或安全组/防火墙没放行该端口。</li>
              <li>外网 502 / 拒绝：本地服务没起，或本地主机/端口填错——隧道只转发，本地得真的在监听。</li>
            </ul>
          </Section>
        </div>

        <div className="border-t border-gray-100 px-6 py-3 text-right dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
