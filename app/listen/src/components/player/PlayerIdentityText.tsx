import "./player-identity.css";
export function PlayerIdentityText({
  title,
  album,
}: {
  title: string;
  album?: string | null;
}) {
  return (
    <>
      <h2 className="listen-player-title text-text-primary">{title}</h2>
      {album ? (
        <p className="mt-1 truncate font-mono text-xs text-text-muted">
          {album}
        </p>
      ) : null}
    </>
  );
}
