import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  clientId: string;
  href?: string;
  /** Adds a danger dot, with sr-only text, when the client has something waiting. */
  needsAction?: boolean;
  className?: string;
};

/** Opaque client id. The only client identity Argus ever holds. */
export function ClientChip({ clientId, href, needsAction = false, className }: Props) {
  const content = (
    <>
      <span>{clientId}</span>
      {needsAction && (
        <>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" />
          <span className="sr-only">, needs action</span>
        </>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cn("client-chip hover:border-control", className)}>
        {content}
      </Link>
    );
  }
  return <span className={cn("client-chip", className)}>{content}</span>;
}
