"use client";

import React, { useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import { formatPct, formatInt } from "@/lib/format";

interface SparklineProps {
  series: SeriesPoint[];
  predParticipation?: number | null;
  targetYear?: number;
  height?: number;
  width?: number;
}

export function Sparkline({
  series,
  predParticipation,
  targetYear = 2027,
  height = 140,
  width = 340,
}: SparklineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!series || series.length === 0) {
    return <div className="text-xs text-slate-500 py-4 text-center">Sin serie histórica disponible</div>;
  }

  // Combine with prediction point if available
  const allPoints = [...series].sort((a, b) => a.year - b.year);
  const minYear = allPoints[0].year;
  const maxYear = predParticipation !== undefined && predParticipation !== null ? targetYear : allPoints[allPoints.length - 1].year;

  // Find min/max participation for dynamic range
  const allValues = allPoints.map((p) => p.participation);
  if (predParticipation !== undefined && predParticipation !== null) {
    allValues.push(predParticipation);
  }
  const minVal = Math.max(0.2, Math.floor((Math.min(...allValues) - 0.05) * 10) / 10);
  const maxVal = Math.min(1.0, Math.ceil((Math.max(...allValues) + 0.05) * 10) / 10);

  const padLeft = 36;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 25;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const getX = (year: number) => {
    return padLeft + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  };

  const getY = (val: number) => {
    return padTop + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  };

  // Build SVG path
  const pathD = allPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.year)} ${getY(p.participation)}`)
    .join(" ");

  // Projection segment to 2027
  let projPathD = "";
  if (predParticipation !== undefined && predParticipation !== null) {
    const lastP = allPoints[allPoints.length - 1];
    projPathD = `M ${getX(lastP.year)} ${getY(lastP.participation)} L ${getX(targetYear)} ${getY(predParticipation)}`;
  }

  return (
    <div className="relative w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none font-sans"
      >
        {/* Horizontal grid lines & Y labels */}
        {[minVal, (minVal + maxVal) / 2, maxVal].map((val, idx) => {
          const y = getY(val);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#334155"
                strokeDasharray="2,2"
                strokeWidth="1"
              />
              <text
                x={padLeft - 4}
                y={y + 3}
                fill="#94a3b8"
                fontSize="9"
                textAnchor="end"
              >
                {Math.round(val * 100)}%
              </text>
            </g>
          );
        })}

        {/* Historical line */}
        <path
          d={pathD}
          fill="none"
          stroke="#0284c7"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Projection dashed line to 2027 */}
        {projPathD && (
          <path
            d={projPathD}
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeDasharray="4,4"
            strokeLinecap="round"
          />
        )}

        {/* Historical Data points */}
        {allPoints.map((p, i) => {
          const cx = getX(p.year);
          const cy = getY(p.participation);
          const isPresidential = [2012, 2018, 2024].includes(p.year);
          const isHovered = hoveredIndex === i;

          return (
            <g
              key={i}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Outer halo for presidential election */}
              {isPresidential && (
                <circle
                  cx={cx}
                  cy={cy}
                  r="7"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  opacity="0.8"
                />
              )}
              {/* Main circle */}
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? "5" : isPresidential ? "4.5" : "3.5"}
                fill={isPresidential ? "#0284c7" : "#e2e8f0"}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              {/* X-axis year label */}
              <text
                x={cx}
                y={height - 6}
                fill="#94a3b8"
                fontSize="9"
                textAnchor="middle"
              >
                {p.year}
              </text>
            </g>
          );
        })}

        {/* Target 2027 Point */}
        {predParticipation !== undefined && predParticipation !== null && (
          <g>
            <circle
              cx={getX(targetYear)}
              cy={getY(predParticipation)}
              r="4.5"
              fill="#10b981"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
            <text
              x={getX(targetYear)}
              y={height - 6}
              fill="#10b981"
              fontWeight="bold"
              fontSize="9"
              textAnchor="middle"
            >
              2027*
            </text>
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoveredIndex !== null && allPoints[hoveredIndex] && (
        <div
          className="absolute z-10 bg-slate-950 text-white text-[11px] p-2 rounded shadow-lg border border-slate-700 pointer-events-none"
          style={{
            left: `${(getX(allPoints[hoveredIndex].year) / width) * 100}%`,
            top: "0px",
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold text-sky-400">
            {allPoints[hoveredIndex].year}{" "}
            {[2012, 2018, 2024].includes(allPoints[hoveredIndex].year) ? "(Presidencial)" : "(Intermedia)"}
          </div>
          <div>Participación: <span className="font-semibold text-white">{formatPct(allPoints[hoveredIndex].participation)}</span></div>
          <div className="text-slate-400">Lista: {formatInt(allPoints[hoveredIndex].lista_nominal)}</div>
        </div>
      )}
    </div>
  );
}
