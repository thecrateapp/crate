import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { Button } from "@crate/ui/shadcn/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";

interface TagPreview {
  current_title: string;
  new_title: string;
  new_track: string;
  duration_diff: number | null;
}

interface MatchResult {
  title: string;
  artist: string;
  date?: string;
  country?: string;
  track_count: number;
  match_score: number;
  tag_preview?: TagPreview[];
}

interface MatchCardProps {
  match: MatchResult;
  onApply: () => void;
}

export function MatchCard({ match, onApply }: MatchCardProps) {
  const sc = match.match_score;
  return (
    <div className="min-w-0 space-y-4 border-b border-border-quiet py-4">
      <EntityRow
        title={match.title}
        subtitle={[
          match.artist,
          match.date || "Date unknown",
          `${match.track_count} tracks`,
          match.country,
        ]
          .filter(Boolean)
          .join(" · ")}
        menuButton="none"
        leading={
          <InfoBadge tone={sc >= 70 ? "accent" : "warning"}>
            {sc}% match
          </InfoBadge>
        }
        trailing={
          <Button variant="outline" onClick={onApply}>
            Apply
          </Button>
        }
      />
      {match.tag_preview && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>MusicBrainz</TableHead>
              <TableHead className="w-16">Delta sec</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {match.tag_preview.map((p) => (
              <TableRow
                key={`${p.new_track}-${p.current_title}-${p.new_title}`}
              >
                <TableCell className="text-muted-foreground">
                  {p.new_track || "?"}
                </TableCell>
                <TableCell>
                  {p.current_title !== p.new_title ? (
                    <span className="text-state-warning-text line-through text-sm">
                      {p.current_title}
                    </span>
                  ) : (
                    <span className="text-sm">{p.current_title}</span>
                  )}
                </TableCell>
                <TableCell>
                  {p.current_title !== p.new_title ? (
                    <span className="text-accent-action-hi text-sm">
                      {p.new_title}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">same</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-sm">
                  {p.duration_diff !== null
                    ? p.duration_diff <= 2
                      ? "ok"
                      : `${p.duration_diff}s`
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
