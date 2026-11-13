import { useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";

const KEYWORDS = new Set([
  "static",
  "const",
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "int",
  "char",
  "size_t",
  "void",
  "unsigned",
  "long",
  "struct",
  "typedef",
  "goto",
  "continue",
  "break",
  "sizeof",
  "NULL",
  "def",
  "class",
  "self",
  "import",
  "from",
  "true",
  "false",
  "True",
  "False",
  "None",
]);

const TOKEN_PATTERN =
  /(\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|b?'(?:\\.|[^'\\])*')|(\b(?:yag_[a-z_]+|yyjson_[a-z_]+|CURL[A-Z0-9_]*|YAG_[A-Z0-9_]+|MAX_[A-Z0-9_]+|SIG[A-Z0-9_]+)\b)|(\b\d+(?:u|UL|L)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function highlightCodeLine(line: string, lineIdx: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(line)) !== null) {
    if (match.index > last) {
      nodes.push(line.slice(last, match.index));
    }
    const full = match[0];
    if (match[1]) {
      nodes.push(
        <span key={`${lineIdx}-${match.index}`} className="tok-com">
          {full}
        </span>,
      );
    } else if (match[2]) {
      nodes.push(
        <span key={`${lineIdx}-${match.index}`} className="tok-str">
          {full}
        </span>,
      );
    } else if (match[3]) {
      nodes.push(
        <span key={`${lineIdx}-${match.index}`} className="tok-type">
          {full}
        </span>,
      );
    } else if (match[4]) {
      nodes.push(
        <span key={`${lineIdx}-${match.index}`} className="tok-num">
          {full}
        </span>,
      );
    } else if (match[5] && KEYWORDS.has(full)) {
      nodes.push(
        <span key={`${lineIdx}-${match.index}`} className="tok-kw">
          {full}
        </span>,
      );
    } else {
      nodes.push(full);
    }
    last = match.index + full.length;
  }

  if (last < line.length) {
    nodes.push(line.slice(last));
  }
  return nodes;
}

export function CopySnippetButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-amber hover:text-paper cursor-pointer"
    >
      <span aria-hidden="true" className={copied ? "text-moss" : "text-amber"}>
        {copied ? "✓" : "⧉"}
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

interface CodeBlockProps {
  code: string;
  lang?: "c" | "python" | "cmake" | "bash" | "json";
  path?: string;
  href?: string;
  badge?: string;
  highlights?: number[];
  showLineNumbers?: boolean;
  caption?: ReactNode;
  className?: string;
}

export function CodeBlock({
  code,
  lang = "c",
  path,
  href,
  badge,
  highlights = [],
  showLineNumbers = true,
  caption,
  className,
}: CodeBlockProps) {
  const lines = code.replace(/\n$/, "").split("\n");

  return (
    <div className={cn("border border-line bg-[rgba(3,12,34,0.62)]", className)}>
      {(path || badge) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/80 px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2.5 font-mono text-[10.5px]">
            <span className="border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.14em] text-amber">
              {lang}
            </span>
            {path &&
              (href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-paper/90 transition-colors hover:text-amber"
                >
                  {path} <span aria-hidden="true" className="text-faint">↗</span>
                </a>
              ) : (
                <span className="truncate text-paper/90">{path}</span>
              ))}
            {badge && <span className="hidden text-[10px] text-faint @lg:inline">· {badge}</span>}
          </div>
          <CopySnippetButton text={code} />
        </div>
      )}

      <pre className="code-scroll overflow-x-auto py-3 font-mono text-[11.5px] leading-[1.74] text-[#dcebff] @lg:text-[12px]">
        <code>
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = highlights.includes(lineNum);
            return (
              <span
                key={idx}
                className={cn(
                  "flex whitespace-pre px-3.5 transition-colors",
                  isHighlighted ? "border-l-2 border-amber bg-amber/[0.07]" : "border-l-2 border-transparent",
                )}
              >
                {showLineNumbers && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mr-4 inline-block w-6 shrink-0 select-none text-right",
                      isHighlighted ? "text-amber" : "text-[#4f6a90]",
                    )}
                  >
                    {lineNum}
                  </span>
                )}
                <span>{line.length > 0 ? highlightCodeLine(line, idx) : " "}</span>
              </span>
            );
          })}
        </code>
      </pre>

      {caption && (
        <div className="border-t border-line bg-panel/40 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-faint">
          {caption}
        </div>
      )}
    </div>
  );
}
