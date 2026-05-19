import { StudioShell } from "@/components/studio/StudioShell";

/**
 * Studio-Layout — gilt für alle Routes unter /studio/*.
 *
 * Wraps children in StudioShell (Sidebar + Main-Area). Server Component;
 * der eigentliche interaktive Code lebt im Shell-Client-Component.
 */
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
