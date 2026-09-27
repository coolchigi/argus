import Link from "next/link";
import { Seal } from "@/components/seal";
import { cn } from "@/lib/utils";

type Props = {
  hash: string;
  /** Show the seal glyph. Only pass true when the record is actually signed. */
  signed?: boolean;
  /** Number of hex characters to show, grouped in fours. */
  chars?: number;
  /** Link to the public receipt, usually `/verify/${hash}`. */
  href?: string;
  className?: string;
};

export function groupHex(hex: string, chars = 12): string {
  const clean = hex.slice(0, chars).toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) groups.push(clean.slice(i, i + 4));
  return groups.join(" ");
}

/** A short, grouped hash. Seal glyph appears only when signed. */
export function Fingerprint({ hash, signed = false, chars = 12, href, className }: Props) {
  const content = (
    <>
      {signed && <Seal className="h-3 w-3 text-seal" />}
      <span aria-hidden>{groupHex(hash, chars)}</span>
      <span className="sr-only">
        {signed ? "Signed record, fingerprint " : "Fingerprint "}
        {hash.slice(0, chars)}
      </span>
    </>
  );
  const base = cn("fingerprint inline-flex items-center gap-1.5", className);
  if (href) {
    return (
      <Link href={href} title={hash} className={cn(base, "hover:text-ink-1 hover:underline underline-offset-4")}>
        {content}
      </Link>
    );
  }
  return (
    <span title={hash} className={base}>
      {content}
    </span>
  );
}
