"use client";

import { useParams } from "next/navigation";
import { StatsPanel } from "@/components/studio/StatsPanel";

export default function StatsPage() {
  const params = useParams<{ id: string }>();
  return <StatsPanel galleryId={params.id} />;
}
