import type { Metadata } from "next";
import { StudyLoader } from "@/components/study/study-loader";

export const metadata: Metadata = { title: "Review due" };

export default function ReviewPage() {
  return <StudyLoader mode="review" title="Review all due" cardCount={0} />;
}
