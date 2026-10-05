"use client";

import React from "react";
import { RiskMap } from "@/components/map/RiskMap";
import { SidePanelTabs } from "@/components/panel/SidePanelTabs";

export default function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 h-[calc(100vh-5.5rem)] min-h-[640px]">
      {/* Map Column (≈65% width on desktop) */}
      <section className="w-full lg:w-[65%] h-[50vh] lg:h-full flex flex-col">
        <RiskMap />
      </section>

      {/* Side Panel Column (≈35% width on desktop) */}
      <aside className="w-full lg:w-[35%] h-auto lg:h-full flex flex-col overflow-hidden">
        <SidePanelTabs />
      </aside>
    </div>
  );
}
