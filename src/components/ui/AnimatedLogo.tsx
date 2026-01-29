// 全息动画 Logo 组件
export function AnimatedLogo({
  size = 30,
  theme = "light"
}: {
  size?: number;
  theme?: "light" | "dark";
}) {
  // 根据主题选择颜色
  const colors = theme === "dark"
    ? {
        bg: "#0a1428",
        stroke: "#00f5ff",
        accent: "#bc13fe",
        text: "#e0f7ff",
        glow: "rgba(0, 245, 255, 0.4)",
      }
    : {
        bg: "#ffffff",      // 纯白背景
        stroke: "#0369a1",  // 深蓝色 (sky-700)
        accent: "#7c3aed",  // 深紫色 (violet-600)
        text: "#0f172a",    // 近黑色文字
        glow: "rgba(3, 105, 161, 0.4)",
      };

  // 为每个实例生成唯一 ID 前缀，避免多个 Logo 时滤镜冲突
  const id = theme;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: `drop-shadow(0 0 6px ${colors.glow})` }}
    >
      <defs>
        {/* 全息发光滤镜 */}
        <filter id={`holo-glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -4"
            result="glow"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* 层板渐变 */}
        <linearGradient id={`shelf-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.stroke} stopOpacity="0.3" />
          <stop offset="50%" stopColor={colors.stroke} stopOpacity="1" />
          <stop offset="100%" stopColor={colors.stroke} stopOpacity="0.3" />
        </linearGradient>

        {/* 圆形遮罩 */}
        <clipPath id={`circle-clip-${id}`}>
          <circle cx="100" cy="100" r="90" />
        </clipPath>
      </defs>

      {/* 外圈能量场 - 呼吸动画 */}
      <circle
        cx="100"
        cy="100"
        r="96"
        fill="none"
        stroke={colors.stroke}
        strokeWidth="0.5"
        opacity="0.4"
      >
        <animate attributeName="r" values="96;99;96" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.15;0.4" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* 主圆形基底 */}
      <circle
        cx="100"
        cy="100"
        r="90"
        fill={colors.bg}
        stroke={colors.stroke}
        strokeWidth="2"
        filter={`url(#holo-glow-${id})`}
      />

      {/* 扫描线动画 */}
      <line
        x1="10"
        y1="50"
        x2="190"
        y2="50"
        stroke={colors.stroke}
        strokeWidth="1"
        opacity="0.2"
        clipPath={`url(#circle-clip-${id})`}
      >
        <animate attributeName="y1" values="20;180;20" dur="4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="20;180;20" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="4s" repeatCount="indefinite" />
      </line>

      {/* 背景六边形网格 */}
      <g clipPath={`url(#circle-clip-${id})`} opacity="0.12">
        <path
          d="M50 50 L100 30 L150 50 L150 100 L100 120 L50 100 Z"
          fill="none"
          stroke={colors.stroke}
          strokeWidth="0.5"
        />
        <path
          d="M50 100 L100 80 L150 100 L150 150 L100 170 L50 150 Z"
          fill="none"
          stroke={colors.accent}
          strokeWidth="0.5"
        />
      </g>

      {/* 书架结构 */}
      <g filter={`url(#holo-glow-${id})`}>
        {/* 左侧立柱 */}
        <rect x="35" y="45" width="3" height="110" rx="1.5" fill={colors.accent} opacity="0.9" />

        {/* 三层层板 */}
        <line
          x1="38" y1="65" x2="162" y2="65"
          stroke={`url(#shelf-grad-${id})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="38" y1="105" x2="162" y2="105"
          stroke={`url(#shelf-grad-${id})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="38" y1="145" x2="162" y2="145"
          stroke={`url(#shelf-grad-${id})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      {/* Git 分支网络 */}
      <g filter={`url(#holo-glow-${id})`}>
        {/* 主节点 - 呼吸动画 */}
        <circle cx="65" cy="55" r="5" fill={colors.stroke}>
          <animate attributeName="r" values="5;6;5" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.7;1" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* 连接线 */}
        <path
          d="M65 60 L65 75 M65 75 L85 75 L85 60"
          stroke={colors.stroke}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* 节点 2 - 脉冲动画 */}
        <circle cx="85" cy="58" r="4" fill={colors.accent}>
          <animate attributeName="r" values="4;5;4" dur="3s" repeatCount="indefinite" />
        </circle>

        {/* 流动数据线 */}
        <line
          x1="65" y1="75" x2="85" y2="75"
          stroke={theme === "dark" ? "#fff" : colors.stroke}
          strokeWidth="2"
          opacity="0.6"
          strokeDasharray="8,16"
        >
          <animate
            attributeName="stroke-dashoffset"
            values="0;24"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </line>

        {/* 连接线 2 */}
        <path
          d="M65 75 L105 75 L105 60"
          stroke={colors.accent}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="2,2"
          opacity="0.6"
        />

        {/* 节点 3 */}
        <circle cx="105" cy="58" r="3.5" fill={colors.stroke} opacity="0.8" />
      </g>

      {/* 中层代码块 */}
      <g filter={`url(#holo-glow-${id})`}>
        <rect
          x="55" y="82" width="45" height="16" rx="2"
          fill={theme === "dark" ? "rgba(0,245,255,0.15)" : "rgba(14,165,233,0.1)"}
          stroke={colors.stroke}
          strokeWidth="0.5"
        />
        <text
          x="62" y="94"
          fontFamily="Consolas, Monaco, monospace"
          fontSize="10"
          fill={colors.stroke}
        >
          {"{ }"}
        </text>

        {/* 状态条动画 */}
        <rect x="105" y="85" width="3" fill={colors.accent} opacity="0.8">
          <animate attributeName="height" values="10;6;10" dur="2s" repeatCount="indefinite" />
          <animate attributeName="y" values="85;87;85" dur="2s" repeatCount="indefinite" />
        </rect>
        <rect x="110" y="83" width="3" fill={colors.stroke} opacity="0.6">
          <animate attributeName="height" values="14;10;14" dur="2.5s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* 底层终端 */}
      <g filter={`url(#holo-glow-${id})`}>
        <text
          x="55" y="135"
          fontFamily="Consolas, Monaco, monospace"
          fontSize="9"
          fill={colors.accent}
        >
          $
        </text>
        <text
          x="62" y="135"
          fontFamily="Consolas, Monaco, monospace"
          fontSize="9"
          fill={colors.text}
        >
          git push
        </text>

        {/* 光标闪烁 */}
        <rect x="100" y="128" width="2" height="8" fill={colors.stroke}>
          <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* 悬浮粒子 */}
      <g opacity="0.5">
        <circle cx="140" cy="130" r="1.5" fill={colors.stroke}>
          <animate attributeName="cy" values="130;120;130" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0.2;0.5" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="155" cy="115" r="1" fill={colors.accent}>
          <animate attributeName="cy" values="115;105;115" dur="4s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* 故障闪现效果 */}
      <g clipPath={`url(#circle-clip-${id})`}>
        <rect x="20" y="70" width="160" height="2" fill="#ff00ff" opacity="0">
          <animate
            attributeName="opacity"
            values="0;0;0;0.5;0;0"
            dur="5s"
            repeatCount="indefinite"
          />
          <animate attributeName="y" values="70;90;120;70" dur="5s" repeatCount="indefinite" />
        </rect>
      </g>
    </svg>
  );
}
