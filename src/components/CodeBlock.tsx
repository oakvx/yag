import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import { XmbRow } from "./XmbRow";

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

export function CopySnippetRow({ text }: { text: string }) {
  const [status, setStatus] = useState("Copy excerpt");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; }
    catch {
      const focused = document.activeElement;
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      finally { area.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }); }
    }
    setStatus(copied ? "Copied" : "Copy unavailable");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("Copy excerpt"), 1800);
  };
  return <XmbRow ariaLabel={status} onClick={() => { void copy(); }} hint="Copy this excerpt to the clipboard."><span role="status">{status}</span></XmbRow>;
}

interface CodeBlockProps {
  code: string;
  lang?: "c" | "python" | "cmake" | "bash" | "json";
  path?: string;
  href?: string;
  highlights?: number[];
  showLineNumbers?: boolean;
  startLine?: number;
  caption?: ReactNode;
  className?: string;
}

export function CodeBlock({ code, lang = "c", path, href, highlights = [], showLineNumbers = true, startLine = 1, caption, className }: CodeBlockProps) {
  const lines = code.replace(/\n$/, "").split("\n");
  return <div className={cn("xmb-code", className)}>
    <div className="xmb-code-toolbar"><span>{path ?? lang}</span><CopySnippetRow text={code} /></div>
    <pre aria-label={path ? `Source: ${path}` : `${lang} excerpt`}><code>{lines.map((line, index) =>
      <span key={index} className="xmb-code-line" data-emphasis={highlights.includes(index + 1)}>
        {showLineNumbers && <span className="xmb-code-number" aria-hidden="true">{index + startLine}</span>}
        <span>{line ? highlightCodeLine(line, index) : " "}</span>
      </span>
    )}</code></pre>
    {href && <XmbRow href={href} value={path} hint="Open the original source on GitHub.">View original source</XmbRow>}
    {caption && <p>{caption}</p>}
  </div>;
}
