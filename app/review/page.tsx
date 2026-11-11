import type { Metadata } from "next";
import { StudyLoader } from "@/components/study/study-loader";

export const metadata: Metadata = { title: "Daily review" };

export default function DailyReviewPage() {
  return <StudyLoader mode="daily" title="Daily review" cardCount={0} />;
}
