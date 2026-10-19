import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";

export function HomeGreeting({
  greeting,
  date,
}: {
  greeting: string;
  date: string;
}) {
  return <PageHeader title={greeting} subtitle={date} />;
}
