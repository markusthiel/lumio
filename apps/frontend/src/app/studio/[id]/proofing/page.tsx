"use client";

import { useParams } from "next/navigation";
import { ProofingPanel } from "@/components/studio/ProofingPanel";

export default function ProofingPage() {
  const params = useParams<{ id: string }>();
  return <ProofingPanel galleryId={params.id} />;
}
