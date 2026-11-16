export function BrandSymbol({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M4 5.5 16 12.5 28 5.5M4 5.5v9L16 22l12-7.5v-9M16 12.5V29" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
    <path d="m4 14.5 12 7.3 12-7.3" stroke="currentColor" strokeWidth="2.1" />
    <path d="M16 2v5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  </svg>;
}

export function GithubMark({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.2.8-.5v-2.1c-3.4.7-4.1-1.4-4.1-1.4-.5-1.3-1.2-1.6-1.2-1.6-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.4-5.5-6.1 0-1.3.5-2.4 1.2-3.3-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.4 1.3a11.8 11.8 0 0 1 6.2 0c2.4-1.6 3.4-1.3 3.4-1.3.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.3 0 4.7-2.8 5.8-5.5 6.1.5.4.8 1.1.8 2.2V22c0 .3.2.6.8.5A11.1 11.1 0 0 0 12 .9Z" /></svg>;
}