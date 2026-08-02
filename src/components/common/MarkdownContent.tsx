import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * 用于弹窗、说明卡片等小块内容的 Markdown 渲染器。
 * 不开放原始 HTML，避免说明文本意外注入可执行标签。
 */
export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div
      className={`min-w-0 text-sm leading-6
        [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-gray-900 dark:[&_h3]:text-gray-100
        [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-gray-900 dark:[&_strong]:text-gray-100
        [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc
        [&_li]:my-1.5 [&_li]:pl-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg
        [&_pre]:border [&_pre]:border-gray-200 dark:[&_pre]:border-gray-700
        [&_pre]:bg-gray-950 [&_pre]:p-3 [&_pre]:text-gray-100
        [&_blockquote]:my-3 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4
        [&_blockquote]:border-blue-400 [&_blockquote]:bg-blue-50 [&_blockquote]:px-3
        [&_blockquote]:py-2 [&_blockquote]:text-blue-800
        dark:[&_blockquote]:border-blue-500 dark:[&_blockquote]:bg-blue-950/40 dark:[&_blockquote]:text-blue-200
        [&_code]:break-words [&_code]:font-mono [&_code]:text-[12px]
        [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-gray-100 [&_:not(pre)>code]:px-1.5
        [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-rose-600
        dark:[&_:not(pre)>code]:bg-gray-800 dark:[&_:not(pre)>code]:text-rose-300 ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
