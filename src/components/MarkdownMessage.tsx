"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          return <CodeBlock>{children}</CodeBlock>;
        },
        a({ children, href }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-950"
            >
              {children}
            </a>
          );
        },
        p({ children }) {
          return <p className="mb-3 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>;
        },
        h1({ children }) {
          return <h1 className="mb-3 text-xl font-semibold text-zinc-950">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="mb-3 text-lg font-semibold text-zinc-950">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mb-2 text-base font-semibold text-zinc-950">{children}</h3>;
        },
        code({ children, className }) {
          if (className) {
            return <code className={className}>{children}</code>;
          }
          return (
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-900">
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = nodeText(children);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 text-zinc-50">
      <div className="flex h-9 items-center justify-end border-b border-white/10 px-2">
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
          aria-label="复制代码"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6">{children}</pre>
    </div>
  );
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return nodeText(props?.children);
  }
  return "";
}
