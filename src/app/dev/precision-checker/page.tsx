import { notFound } from "next/navigation";

import PrecisionChecker from "@/components/dev/PrecisionChecker";
import { isDevBacktestEnabled } from "@/lib/dev/enabled";

export const dynamic = "force-dynamic";

export default function Home() {
    if (!isDevBacktestEnabled()) {
        notFound();
    }

    return <PrecisionChecker />;
}
