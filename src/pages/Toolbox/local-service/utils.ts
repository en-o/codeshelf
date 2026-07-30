import type { ForwardRule, ServerConfig } from "@/types/toolbox";

/**
 * 展示用的可访问地址必须与真实绑定一致。
 * 之前一律显示 127.0.0.1，而后端一律绑 0.0.0.0 —— 用户看不出服务已经对整个局域网开放。
 */
export function serviceHost(exposeLan?: boolean): string {
  return exposeLan ? "0.0.0.0" : "127.0.0.1";
}

/** 已对局域网开放时给出的提示文案（列表里挂在地址旁边）。 */
export function lanWarning(exposeLan?: boolean): string | null {
  return exposeLan ? "已对局域网开放：同一网络下的设备都能访问" : null;
}

export function getServerUrl(server: ServerConfig): string {
  const prefix = server.urlPrefix === "/" ? "" : server.urlPrefix;
  const base = `http://${serviceHost(server.exposeLan)}:${server.port}${prefix}`;

  if (server.indexPage) {
    const index = server.indexPage.startsWith("/") ? server.indexPage : `/${server.indexPage}`;
    return `${base}${index}`;
  }

  return `${base}/`;
}

export function getForwardUrl(rule: ForwardRule): string {
  const base = `http://${serviceHost(rule.exposeLan)}:${rule.localPort}`;
  if (rule.docPath) {
    const docPath = rule.docPath.startsWith("/") ? rule.docPath : `/${rule.docPath}`;
    return `${base}${docPath}`;
  }
  return base;
}

export function nginxFileName(server: ServerConfig): string {
  const safeName = server.name.trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, "-") || "service";
  return `${safeName}-nginx.conf`;
}
