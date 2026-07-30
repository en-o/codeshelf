import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import {
  dockerBuildImage,
  dockerCheckAvailable,
  dockerFindDockerfiles,
  dockerGenerateDockerfileAi,
  dockerGenerateDockerfileTemplate,
  dockerInspectContainerYaml,
  dockerListContainers,
  dockerListImages,
  dockerPushImage,
  dockerReadDockerfile,
  dockerRemoveContainer,
  dockerRemoveImage,
  dockerRestartContainer,
  dockerRunImage,
  dockerStartContainer,
  dockerStopContainer,
  dockerWriteDockerfile,
  getCurrentPlatform,
} from "@/services/toolbox";
import type { DockerCommandResult, DockerContainerInfo, DockerImageInfo, DockerStatus } from "@/types/toolbox";
import { buildAiPrompt, dockerImageNameFromProject, hasUsableAiProvider, splitListText } from "./utils";

/**
 * 镜像引用里是否**已经**带了 tag 或 digest。
 *
 * 不能直接 `includes(":")`：registry 主机名可以带端口，
 * `localhost:5000/team/app` 里的冒号是端口不是 tag ——
 * 误判成「已有 tag」会让用户填的 tag 被静默忽略。
 *
 * 规则与后端 `has_tag_or_digest`（docker/commands.rs）保持一致：
 * 含 `@` 即带 digest；否则只看最后一个 `/` 之后的部分有没有 `:`。
 */
function hasTagOrDigest(image: string): boolean {
  const s = image.trim();
  if (s.includes("@")) return true;
  const lastSlash = s.lastIndexOf("/");
  return (lastSlash >= 0 ? s.slice(lastSlash + 1) : s).includes(":");
}


interface UseDockerImageToolOptions {
  initialProjectPath?: string;
  initialProjectName?: string;
  onInitialProjectConsumed?: () => void;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

export function useDockerImageTool(options: UseDockerImageToolOptions = {}) {
  const { aiProviders } = useAiProvidersStore();
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [platform, setPlatform] = useState("");
  const [projectPath, setProjectPath] = useState(options.initialProjectPath || "");
  const [dockerfiles, setDockerfiles] = useState<string[]>([]);
  const [dockerfilePath, setDockerfilePath] = useState("Dockerfile");
  const [dockerfileContent, setDockerfileContent] = useState("");
  const [template, setTemplate] = useState("auto");
  const [imageName, setImageName] = useState(dockerImageNameFromProject(options.initialProjectName));
  const [imageTag, setImageTag] = useState("latest");
  const [noCache, setNoCache] = useState(false);
  const [runImage, setRunImage] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [containerName, setContainerName] = useState("");
  const [portsText, setPortsText] = useState("8080:80");
  const [envText, setEnvText] = useState("");
  const [volumesText, setVolumesText] = useState("");
  const [network, setNetwork] = useState("");
  const [restart, setRestart] = useState("");
  const [user, setUser] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [command, setCommand] = useState("");
  const [extraArgsText, setExtraArgsText] = useState("");
  const [privileged, setPrivileged] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [images, setImages] = useState<DockerImageInfo[]>([]);
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastResult, setLastResult] = useState<DockerCommandResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [containerConfigYaml, setContainerConfigYaml] = useState("");
  const [containerConfigName, setContainerConfigName] = useState("");
  const [containerConfigOpen, setContainerConfigOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const aiReady = useMemo(() => hasUsableAiProvider(aiProviders), [aiProviders]);
  const fullImageName = useMemo(() => {
    const name = imageName.trim();
    if (!name) return "";
    return hasTagOrDigest(name) ? name : `${name}:${imageTag.trim() || "latest"}`;
  }, [imageName, imageTag]);

  useEffect(() => {
    refreshDocker();
    getCurrentPlatform().then(setPlatform).catch(() => setPlatform(""));
  }, []);

  // Docker 状态自动刷新（每 3 秒拉一次容器/镜像列表，前提是 docker 可用）
  useEffect(() => {
    if (!status?.available) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      refreshDockerLists({ silent: true }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [status?.available]);

  useEffect(() => {
    if (!options.initialProjectPath) return;
    setProjectPath(options.initialProjectPath);
    setImageName(dockerImageNameFromProject(options.initialProjectName));
    scanDockerfiles(options.initialProjectPath);
    options.onInitialProjectConsumed?.();
  }, [options.initialProjectPath]);

  async function refreshDocker() {
    setRefreshing(true);
    try {
      const nextStatus = await dockerCheckAvailable();
      setStatus(nextStatus);
      if (nextStatus.available) {
        await refreshDockerLists({ silent: true });
      }
      setRefreshTick((t) => t + 1);
    } finally {
      // 保证 spinner 至少转一小段时间，否则数据本来就是新的会感觉没反应
      setTimeout(() => setRefreshing(false), 350);
    }
  }

  async function refreshDockerLists(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setRefreshing(true);
    try {
      const [nextImages, nextContainers] = await Promise.all([
        dockerListImages(),
        dockerListContainers(),
      ]);
      setImages(nextImages);
      setContainers(nextContainers);
      if (!opts.silent) setRefreshTick((t) => t + 1);
    } catch (error) {
      console.error("刷新 Docker 列表失败:", error);
    } finally {
      if (!opts.silent) {
        setTimeout(() => setRefreshing(false), 350);
      }
    }
  }

  async function selectProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择项目目录",
    });
    if (!selected || typeof selected !== "string") return;
    setProjectPath(selected);
    await scanDockerfiles(selected);
  }

  async function scanDockerfiles(path = projectPath) {
    if (!path) return;
    const found = await dockerFindDockerfiles(path);
    setDockerfiles(found);
    if (found.length > 0) {
      setDockerfilePath(found[0]);
      const content = await dockerReadDockerfile(path, found[0]);
      setDockerfileContent(content);
    } else {
      setDockerfilePath("Dockerfile");
      setDockerfileContent("");
    }
  }

  async function loadDockerfile(path = dockerfilePath) {
    if (!projectPath || !path) return;
    const content = await dockerReadDockerfile(projectPath, path);
    setDockerfileContent(content);
  }

  async function generateTemplate() {
    if (!projectPath) {
      alert("请先选择项目目录");
      return;
    }
    const content = await dockerGenerateDockerfileTemplate(projectPath, template);
    setDockerfilePath(dockerfilePath || "Dockerfile");
    setDockerfileContent(content);
    setNotice("");
  }

  async function generateWithAi() {
    if (!projectPath) {
      alert("请先选择项目目录");
      return;
    }
    if (!aiReady) {
      setNotice("AI 未配置或没有启用模型，可先使用模板或复制 AI 提示。");
      return;
    }
    setBusy(true);
    try {
      const result = await dockerGenerateDockerfileAi({
        projectPath,
        dockerfilePath: dockerfilePath.trim() || "Dockerfile",
        imageName: fullImageName || imageName,
      });
      setDockerfilePath(dockerfilePath.trim() || "Dockerfile");
      setDockerfileContent(result.content);
      setNotice(`已由 ${result.providerName} / ${result.modelName} 生成，可继续修改后保存或构建。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveDockerfile() {
    if (!projectPath || !dockerfilePath.trim()) {
      alert("请先选择项目目录并填写 Dockerfile 路径");
      return;
    }
    await dockerWriteDockerfile(projectPath, dockerfilePath.trim(), dockerfileContent);
    await scanDockerfiles(projectPath);
  }

  function requestConfirm(request: ConfirmRequest) {
    setConfirmRequest(request);
  }

  function buildImage() {
    if (!projectPath || !dockerfilePath.trim() || !imageName.trim()) {
      alert("请填写项目目录、Dockerfile 和镜像名");
      return;
    }
    const target = fullImageName || imageName.trim();
    requestConfirm({
      title: "构建镜像",
      message: `确定构建镜像 ${target} 吗？`,
      confirmLabel: "确认构建",
      onConfirm: async () => executeBuildImage(),
    });
  }

  async function executeBuildImage() {
    setBusy(true);
    try {
      await saveDockerfile();
      const result = await dockerBuildImage({
        projectPath,
        dockerfilePath: dockerfilePath.trim(),
        imageName: imageName.trim(),
        tag: imageTag.trim() || "latest",
        noCache,
      });
      setLastResult(result);
      setRunImage(fullImageName);
      await refreshDockerLists();
    } finally {
      setBusy(false);
    }
  }

  function runSelectedImage(image = runImage || fullImageName) {
    if (!image.trim()) {
      alert("请填写要运行的镜像");
      return;
    }
    const target = image.trim();
    requestConfirm({
      title: "运行镜像",
      message: `确定运行镜像 ${target} 吗？`,
      confirmLabel: "确认运行",
      onConfirm: async () => executeRunImage(target),
    });
  }

  async function executeRunImage(image: string) {
    setBusy(true);
    try {
      const result = await dockerRunImage({
        image,
        containerName: containerName.trim() || undefined,
        ports: splitListText(portsText),
        env: splitListText(envText),
        volumes: splitListText(volumesText),
        network: network.trim() || undefined,
        restart: restart.trim() || undefined,
        user: user.trim() || undefined,
        workdir: workdir.trim() || undefined,
        command: command.trim() || undefined,
        privileged,
        readOnly,
        extraArgs: splitListText(extraArgsText),
      });
      setLastResult(result);
      await refreshDockerLists();
      setRunDialogOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function openRunDialog(image = runImage || fullImageName) {
    setRunImage(image);
    setRunDialogOpen(true);
  }

  function removeImage(image: string) {
    requestConfirm({
      title: "删除镜像",
      message: `确定删除镜像 ${image} 吗？`,
      confirmLabel: "确认删除",
      danger: true,
      onConfirm: async () => {
        const result = await dockerRemoveImage(image, true);
        setLastResult(result);
        await refreshDockerLists();
      },
    });
  }

  function pushImage(image: string) {
    requestConfirm({
      title: "推送镜像",
      message: `确定推送镜像 ${image} 吗？`,
      confirmLabel: "确认推送",
      onConfirm: async () => {
        const result = await dockerPushImage(image);
        setLastResult(result);
      },
    });
  }

  function stopContainer(id: string) {
    requestConfirm({
      title: "停止容器",
      message: `确定停止容器 ${id} 吗？`,
      confirmLabel: "确认停止",
      danger: true,
      onConfirm: async () => {
        const result = await dockerStopContainer(id);
        setLastResult(result);
        await refreshDockerLists();
      },
    });
  }

  async function startContainer(id: string) {
    try {
      const result = await dockerStartContainer(id);
      setLastResult(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      await refreshDockerLists();
    }
  }

  function restartContainer(id: string) {
    requestConfirm({
      title: "重启容器",
      message: `确定重启容器 ${id} 吗？`,
      confirmLabel: "确认重启",
      onConfirm: async () => {
        const result = await dockerRestartContainer(id);
        setLastResult(result);
        await refreshDockerLists();
      },
    });
  }

  function removeContainer(id: string) {
    requestConfirm({
      title: "删除容器",
      message: `确定删除容器 ${id} 吗？`,
      confirmLabel: "确认删除",
      danger: true,
      onConfirm: async () => {
        const result = await dockerRemoveContainer(id, true);
        setLastResult(result);
        await refreshDockerLists();
      },
    });
  }

  async function inspectContainerConfig(container: string, name?: string) {
    setContainerConfigName(name || container);
    setContainerConfigOpen(true);
    setContainerConfigYaml("加载中...");
    try {
      const yaml = await dockerInspectContainerYaml(container);
      setContainerConfigYaml(yaml);
    } catch (error) {
      setContainerConfigYaml(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyAiPrompt() {
    await navigator.clipboard.writeText(buildAiPrompt({
      projectPath,
      imageName: fullImageName,
      dockerfileContent,
      platform,
    }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return {
    state: {
      aiReady,
      busy,
      containerName,
      containers,
      copied,
      dockerfileContent,
      dockerfilePath,
      dockerfiles,
      refreshing,
      refreshTick,
      envText,
      extraArgsText,
      fullImageName,
      imageName,
      imageTag,
      images,
      lastResult,
      network,
      noCache,
      notice,
      platform,
      portsText,
      projectPath,
      privileged,
      readOnly,
      restart,
      runImage,
      runDialogOpen,
      status,
      template,
      user,
      volumesText,
      workdir,
      command,
      containerConfigYaml,
      containerConfigName,
      containerConfigOpen,
      confirmRequest,
    },
    setters: {
      setContainerName,
      setContainerConfigOpen,
      setDockerfileContent,
      setDockerfilePath,
      setEnvText,
      setExtraArgsText,
      setImageName,
      setImageTag,
      setNetwork,
      setNoCache,
      setPortsText,
      setPrivileged,
      setProjectPath,
      setReadOnly,
      setRestart,
      setRunImage,
      setRunDialogOpen,
      setTemplate,
      setUser,
      setVolumesText,
      setWorkdir,
      setCommand,
      setConfirmRequest,
    },
    actions: {
      buildImage,
      copyAiPrompt,
      generateTemplate,
      generateWithAi,
      inspectContainerConfig,
      loadDockerfile,
      openRunDialog,
      pushImage,
      refreshDocker,
      refreshDockerLists,
      removeContainer,
      removeImage,
      restartContainer,
      runSelectedImage,
      saveDockerfile,
      scanDockerfiles,
      selectProject,
      startContainer,
      stopContainer,
    },
  };
}

export type DockerImageToolModel = ReturnType<typeof useDockerImageTool>;
