import { notFound } from "next/navigation";


import { isDevBacktestEnabled } from "@/lib/dev/enabled";
import BacktestPrecision from "@/components/dev/BacktestPrecision";

export const dynamic = "force-dynamic";

export default function Home() {
    if (!isDevBacktestEnabled()) {
        notFound();
    }

    return <BacktestPrecision />;
}
