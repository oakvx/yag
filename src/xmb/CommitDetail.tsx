import { useEffect, useRef, type RefObject } from "react";
import type { CommitNotice } from "@/data/commits.generated";
import { REPO_LINKS } from "@/data/repository";

export function CommitDetail({ commit, onBack, scrollRef }: {
  commit: CommitNotice;
  onBack: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [commit.sha]);
  return (
    <section className="console-commit" aria-labelledby="commit-title">
      <button type="button" className="console-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" className="controller-glyph" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="m14.6 7.6-4.8 4.4 4.8 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to notifications
      </button>
      <div ref={scrollRef} className="console-commit-content code-scroll" tabIndex={0} aria-label="Commit details">
        <h2 id="commit-title" ref={titleRef} tabIndex={-1}>{commit.subject}</h2>
        <dl className="console-commit-meta">
          <div><dt>Author</dt><dd>{commit.author}</dd></div>
          <div><dt>Date</dt><dd><time dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time></dd></div>
          <div><dt>Commit</dt><dd>{commit.sha}</dd></div>
          <div><dt>Type</dt><dd>{commit.kind}</dd></div>
        </dl>
        {commit.body && <p className="console-commit-message">{commit.body}</p>}
        <h3>Changed files{commit.files ? ` (${commit.files.length})` : ""}</h3>
        {commit.files === undefined ? <p>File changes are unavailable for this commit.</p>
          : commit.files.length === 0 ? <p>No file changes in this commit.</p>
          : commit.files.map((file) => (
            <details key={file.path} className="console-commit-file">
              <summary><span>{file.path}</span><span className="console-commit-stats">{file.binary ? "Binary" : `+${file.added} / −${file.deleted}`}</span></summary>
              {file.binary ? <p>Binary file changed. Text diff is unavailable.</p> : file.patch ? <pre tabIndex={0} aria-label={`Changes to ${file.path}`}><code>{file.patch}</code></pre> : null}
              {file.truncated && <p>Diff excerpt. The full change exceeds this view’s size limit.</p>}
            </details>
          ))}
        <a className="console-commit-source" href={`${REPO_LINKS.repo}/commit/${commit.sha}`} target="_blank" rel="noopener noreferrer">View on GitHub (new tab)</a>
      </div>
    </section>
  );
}
