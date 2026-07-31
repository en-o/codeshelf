import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parse as parseYaml } from "yaml";
import type { ApiAuthConfig, ApiEndpoint, ApiGroup } from "@/types";
import { fetchApiDocumentUrl } from "@/services/api_chat";

type AnyRecord = Record<string, unknown>;

interface ImportResult {
  groups: ApiGroup[];
  endpoints: ApiEndpoint[];
  title: string;
  /**
   * 导入过程中**被跳过**的内容，供界面如实告知用户。
   *
   * 原来不支持的 operation 是静默 `continue` 掉的：用户导入 20 个接口、
   * 界面显示"导入成功"，实际只进来 17 个，另外 3 个 HEAD/OPTIONS 凭空消失，
   * 而且没有任何提示。
   */
  skipped: string[];
}

/**
 * 支持导入的 HTTP 方法。
 *
 * 原来只有 GET/POST/PUT/PATCH/DELETE，而 OpenAPI 的 Path Item 合法方法还包括
 * HEAD / OPTIONS / TRACE —— 这三个会被静默丢弃。它们与其它方法在本项目里
 * 走的是同一条执行路径（reqwest 按方法名发请求），没有理由不支持。
 */
const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

/** Path Item 里不是 HTTP 方法的合法键，跳过它们是正常的，不该报告为"丢弃" */
const NON_OPERATION_KEYS = new Set([
  "summary",
  "description",
  "servers",
  "parameters",
  "$ref",
]);

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function makeId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid.replace(/-/g, "").slice(0, 24)}`;
}

function parseDocument(content: string): AnyRecord {
  try {
    const parsed = JSON.parse(content);
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through to YAML
  }
  const parsed = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new Error("接口文档格式不正确");
  }
  return parsed;
}

function resolveRef(doc: AnyRecord, value: unknown, seen = new Set<string>()): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string") return value;
  const ref = value.$ref;
  if (!ref.startsWith("#/") || seen.has(ref)) return value;
  seen.add(ref);
  const target = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), doc);
  return resolveRef(doc, target, seen);
}

function sanitizeSchema(doc: AnyRecord, schema: unknown, seen = new Set<string>()): AnyRecord {
  const resolved = resolveRef(doc, schema, seen);
  if (!isRecord(resolved)) return {};

  const out: AnyRecord = {};
  const copyKeys = [
    "type",
    "format",
    "title",
    "description",
    "enum",
    "default",
    "example",
    "examples",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "required",
    "additionalProperties",
  ];
  for (const key of copyKeys) {
    if (resolved[key] !== undefined) out[key] = resolved[key];
  }
  if (resolved.nullable === true && typeof out.type === "string") {
    out.type = [out.type, "null"];
  }
  if (isRecord(resolved.properties)) {
    out.type = out.type ?? "object";
    out.properties = Object.fromEntries(
      Object.entries(resolved.properties).map(([key, value]) => [
        key,
        sanitizeSchema(doc, value, new Set(seen)),
      ]),
    );
  }
  if (resolved.items !== undefined) {
    out.items = sanitizeSchema(doc, resolved.items, new Set(seen));
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (Array.isArray(resolved[key])) {
      out[key] = (resolved[key] as unknown[]).map((item) => sanitizeSchema(doc, item, new Set(seen)));
    }
  }
  if (Object.keys(out).length === 0) {
    return { type: "string" };
  }
  return out;
}

function schemaFromParameter(doc: AnyRecord, param: AnyRecord): AnyRecord {
  const schema = isRecord(param.schema)
    ? sanitizeSchema(doc, param.schema)
    : sanitizeSchema(doc, {
        type: param.type ?? "string",
        format: param.format,
        enum: param.enum,
        default: param.default,
      });
  if (typeof param.description === "string" && !schema.description) {
    schema.description = param.description;
  }
  return schema;
}

function paramsToObjectSchema(doc: AnyRecord, params: AnyRecord[]): AnyRecord | undefined {
  if (params.length === 0) return undefined;
  const properties: AnyRecord = {};
  const required: string[] = [];
  for (const param of params) {
    const name = asString(param.name);
    if (!name) continue;
    properties[name] = schemaFromParameter(doc, param);
    if (param.required === true) required.push(name);
  }
  if (Object.keys(properties).length === 0) return undefined;
  const schema: AnyRecord = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function mergeParameters(doc: AnyRecord, pathItem: AnyRecord, operation: AnyRecord): AnyRecord[] {
  const merged = new Map<string, AnyRecord>();
  const addAll = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const resolved = resolveRef(doc, item);
      if (!isRecord(resolved)) continue;
      const name = asString(resolved.name);
      const location = asString(resolved.in);
      if (!name || !location) continue;
      merged.set(`${location}:${name}`, resolved);
    }
  };
  addAll(pathItem.parameters);
  addAll(operation.parameters);
  return Array.from(merged.values());
}

function pickRequestBodySchema(doc: AnyRecord, operation: AnyRecord): { schema?: AnyRecord; required: boolean } {
  const requestBody = resolveRef(doc, operation.requestBody);
  if (isRecord(requestBody) && isRecord(requestBody.content)) {
    const entries = Object.entries(requestBody.content);
    const picked = entries.find(([type]) => type.includes("json")) ?? entries[0];
    const media = picked?.[1];
    if (isRecord(media) && media.schema !== undefined) {
      return {
        schema: sanitizeSchema(doc, media.schema),
        required: requestBody.required === true,
      };
    }
  }

  const params = Array.isArray(operation.parameters)
    ? operation.parameters.map((param) => resolveRef(doc, param)).filter(isRecord)
    : [];
  const bodyParam = params.find((param) => param.in === "body");
  if (bodyParam) {
    return {
      schema: sanitizeSchema(doc, bodyParam.schema),
      required: bodyParam.required === true,
    };
  }

  const formParams = params.filter((param) => param.in === "formData");
  return {
    schema: paramsToObjectSchema(doc, formParams),
    required: formParams.some((param) => param.required === true),
  };
}

function buildParamsSchema(doc: AnyRecord, pathItem: AnyRecord, operation: AnyRecord): AnyRecord {
  const params = mergeParameters(doc, pathItem, operation);
  const pathSchema = paramsToObjectSchema(doc, params.filter((param) => param.in === "path"));
  const querySchema = paramsToObjectSchema(doc, params.filter((param) => param.in === "query"));
  const { schema: bodySchema, required: bodyRequired } = pickRequestBodySchema(doc, operation);

  const properties: AnyRecord = {};
  const required: string[] = [];
  if (pathSchema) {
    properties._path = { ...pathSchema, description: "URL 路径参数" };
    required.push("_path");
  }
  if (querySchema) {
    properties._query = { ...querySchema, description: "URL 查询参数" };
    if (Array.isArray(querySchema.required) && querySchema.required.length > 0) required.push("_query");
  }
  if (bodySchema && Object.keys(bodySchema).length > 0) {
    properties._body = { ...bodySchema, description: bodySchema.description ?? "请求体 JSON" };
    if (bodyRequired) required.push("_body");
  }

  if (Object.keys(properties).length === 0) {
    return { type: "object", properties: {} };
  }
  const schema: AnyRecord = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function serverUrl(doc: AnyRecord): string {
  if (Array.isArray(doc.servers) && isRecord(doc.servers[0])) {
    const server = doc.servers[0];
    let url = asString(server.url) ?? "";
    if (isRecord(server.variables)) {
      const variables = server.variables;
      url = url.replace(/\{([^}]+)\}/g, (_, name: string) => {
        const variable = variables[name];
        return isRecord(variable) && variable.default != null ? String(variable.default) : "";
      });
    }
    return url.replace(/\/$/, "");
  }

  const host = asString(doc.host) ?? "";
  const basePath = asString(doc.basePath) ?? "";
  const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
  const scheme = asString(schemes[0]) ?? (host ? "https" : "");
  if (host) return `${scheme}://${host}${basePath}`.replace(/\/$/, "");
  return basePath.replace(/\/$/, "");
}

function authFromScheme(scheme: unknown): ApiAuthConfig | null {
  if (!isRecord(scheme)) return null;
  if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "bearer") {
    return { type: "bearer", token: "" };
  }
  if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
    return { type: "basic", username: "", password: "" };
  }
  if (scheme.type === "basic") {
    return { type: "basic", username: "", password: "" };
  }
  if (scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string") {
    return { type: "apiKey", header: scheme.name, value: "" };
  }
  return null;
}

function authForSecurity(doc: AnyRecord, security: unknown): ApiAuthConfig | null {
  const schemes = isRecord(doc.components) && isRecord(doc.components.securitySchemes)
    ? doc.components.securitySchemes
    : isRecord(doc.securityDefinitions)
      ? doc.securityDefinitions
      : {};
  const securityItems = Array.isArray(security) ? security : [];
  const preferredName = securityItems
    .map((item) => (isRecord(item) ? Object.keys(item)[0] : undefined))
    .find(Boolean);
  if (preferredName && isRecord(schemes)) {
    const auth = authFromScheme(schemes[preferredName]);
    if (auth) return auth;
  }
  if (isRecord(schemes)) {
    for (const value of Object.values(schemes)) {
      const auth = authFromScheme(value);
      if (auth) return auth;
    }
  }
  return null;
}

function sameAuth(a: ApiAuthConfig, b: ApiAuthConfig | null): boolean {
  return b != null && a.type === b.type && JSON.stringify(a) === JSON.stringify(b);
}

function operationName(method: string, path: string, operation: AnyRecord): string {
  return asString(operation.summary)
    ?? asString(operation.operationId)
    ?? `${method.toUpperCase()} ${path}`;
}

function operationDescription(method: string, path: string, operation: AnyRecord): string {
  const parts = [
    Array.isArray(operation.tags) && operation.tags.length > 0
      ? `文档分组：${operation.tags.filter((tag) => typeof tag === "string").join(" / ")}`
      : "",
    asString(operation.description),
    asString(operation.summary),
    `${method.toUpperCase()} ${path}`,
  ].filter(Boolean);
  return Array.from(new Set(parts)).join("\n");
}

export function parseOpenApiDocument(content: string): ImportResult {
  const doc = parseDocument(content);
  const version = asString(doc.openapi) ?? asString(doc.swagger);
  if (!version || !isRecord(doc.paths)) {
    throw new Error("不是有效的 OpenAPI 3.x / Swagger 2.0 文档");
  }

  const info = isRecord(doc.info) ? doc.info : {};
  const title = asString(info.title) ?? "导入接口文档";
  const groupId = makeId("api_group");
  const groupAuth = authForSecurity(doc, doc.security) ?? { type: "none" };
  const group: ApiGroup = {
    id: groupId,
    name: title,
    description: asString(info.description) ?? `由 ${version} 接口文档导入`,
    baseUrl: serverUrl(doc),
    auth: groupAuth,
    createdAt: "",
    updatedAt: "",
  };

  const endpoints: ApiEndpoint[] = [];
  const skipped: string[] = [];
  for (const [path, rawPathItem] of Object.entries(doc.paths)) {
    if (!isRecord(rawPathItem)) {
      skipped.push(`${path}（路径项格式不正确）`);
      continue;
    }
    for (const [method, rawOperation] of Object.entries(rawPathItem)) {
      if (NON_OPERATION_KEYS.has(method)) continue; // 正常的非 operation 键
      if (!HTTP_METHODS.has(method)) {
        skipped.push(`${method.toUpperCase()} ${path}（不支持的方法）`);
        continue;
      }
      if (!isRecord(rawOperation)) {
        skipped.push(`${method.toUpperCase()} ${path}（operation 格式不正确）`);
        continue;
      }
      const operationSecurity = rawOperation.security;
      const operationAuth = Array.isArray(operationSecurity)
        ? authForSecurity(doc, operationSecurity)
        : null;
      const authOverride = Array.isArray(operationSecurity) && operationSecurity.length === 0
        ? { type: "none" } as ApiAuthConfig
        : sameAuth(groupAuth, operationAuth)
          ? undefined
          : operationAuth ?? undefined;

      endpoints.push({
        id: makeId("api_ep"),
        name: operationName(method, path, rawOperation),
        description: operationDescription(method, path, rawOperation),
        groupId,
        method: method.toUpperCase(),
        url: path,
        headers: [],
        authOverride,
        paramsSchema: buildParamsSchema(doc, rawPathItem, rawOperation),
        responseTrimBytes: undefined,
        createdAt: "",
        updatedAt: "",
      });
    }
  }

  if (endpoints.length === 0) {
    throw new Error(
      skipped.length > 0
        ? `文档中没有可导入的接口。已跳过 ${skipped.length} 项：${skipped.slice(0, 5).join("、")}${skipped.length > 5 ? " 等" : ""}`
        : "文档中没有可导入的接口",
    );
  }
  return { groups: [group], endpoints, title, skipped };
}

export async function importOpenApiDocument(): Promise<ImportResult | null> {
  const picked = await open({
    title: "导入接口文档",
    multiple: false,
    filters: [
      { name: "OpenAPI / Swagger / Apifox", extensions: ["json", "yaml", "yml"] },
    ],
  });
  if (!picked || Array.isArray(picked)) return null;
  const content = await readTextFile(picked as string);
  return parseOpenApiDocument(content);
}

export async function importOpenApiDocumentFromUrl(url: string): Promise<ImportResult> {
  const content = await fetchApiDocumentUrl(url);
  return parseOpenApiDocument(content);
}
