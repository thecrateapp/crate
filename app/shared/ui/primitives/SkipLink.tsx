/** First keyboard stop in a shell; apps provide the translated label and main landmark ID. */
export function SkipLink({
  targetId,
  children,
}: {
  targetId: string;
  children: string;
}) {
  return (
    <a
      className="crate-skip-link font-mono text-sm"
      href={`#${targetId}`}
      onClick={(event) => {
        const target =
          event.currentTarget.ownerDocument.getElementById(targetId);
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }}
    >
      {children}
    </a>
  );
}
