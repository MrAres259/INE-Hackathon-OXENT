"use client";

import React, { useEffect } from "react";
import { RiskMap } from "@/components/map/RiskMap";
import { SidePanelTabs } from "@/components/panel/SidePanelTabs";

export default function DashboardPage() {
  useEffect(() => {
    document.body.classList.add("lg:overflow-hidden");
    return () => {
      document.body.classList.remove("lg:overflow-hidden");
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
      {/* Map Column (≈65% width on desktop) */}
      <section className="w-full lg:w-[65%] h-[60vh] min-h-[420px] lg:h-full lg:min-h-0 flex flex-col">
        <RiskMap />
      </section>

      {/* Side Panel Column (≈35% width on desktop) */}
      <aside className="w-full lg:w-[35%] h-auto lg:h-full lg:min-h-0 flex flex-col overflow-hidden">
        <SidePanelTabs />
      </aside>
    </div>
  );
}
