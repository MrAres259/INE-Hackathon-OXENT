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
  height = 145,
  width = 340,
}: SparklineProps) {
  const [hoveredPoint, setHoveredPoint] = useState<SeriesPoint | null>(null);

  if (!series || series.length === 0) {
    return <div className="text-xs text-slate-500 py-4 text-center">Sin serie histórica disponible</div>;
  }

  // Separate DIP_FED (principal series with connected line) and PRES (presidential separate points)
  const dipFedPoints = series
    .filter((p) => !p.election || p.election === "DIP_FED")
    .sort((a, b) => a.year - b.year);

  const presPoints = series
    .filter((p) => p.election === "PRES")
    .sort((a, b) => a.year - b.year);

  const allPoints = [...series].sort((a, b) => a.year - b.year);
  const minYear = allPoints[0].year;
  const maxYear =
    predParticipation !== undefined && predParticipation !== null
      ? targetYear
      : allPoints[allPoints.length - 1].year;

  // Find min/max participation for dynamic range
  const allValues = allPoints.map((p) => p.participation);
  if (predParticipation !== undefined && predParticipation !== null) {
    allValues.push(predParticipation);
  }
  const minVal = Math.max(0.1, Math.floor((Math.min(...allValues) - 0.05) * 10) / 10);
  const maxVal = Math.min(1.0, Math.ceil((Math.max(...allValues) + 0.05) * 10) / 10);

  const padLeft = 36;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 25;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const getX = (year: number) => {
    if (maxYear === minYear) return padLeft + chartWidth / 2;
    return padLeft + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  };

  const getY = (val: number) => {
    if (maxVal === minVal) return padTop + chartHeight / 2;
    return padTop + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  };

  // Connected line for DIP_FED
  const pathD = dipFedPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.year)} ${getY(p.participation)}`)
    .join(" ");

  // Projection segment to 2027 from last DIP_FED point
  let projPathD = "";
  if (
    predParticipation !== undefined &&
    predParticipation !== null &&
    dipFedPoints.length > 0
  ) {
    const lastP = dipFedPoints[dipFedPoints.length - 1];
    projPathD = `M ${getX(lastP.year)} ${getY(lastP.participation)} L ${getX(targetYear)} ${getY(predParticipation)}`;
  }

  return (
    <div className="relative w-full overflow-hidden space-y-2">
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

        {/* DIP_FED continuous line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#0284c7"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

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

        {/* DIP_FED Data points */}
        {dipFedPoints.map((p, i) => {
          const cx = getX(p.year);
          const cy = getY(p.participation);

          return (
            <g
              key={`dip-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <circle
                cx={cx}
                cy={cy}
                r="4"
                fill="#0284c7"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
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

        {/* PRES Data points (diamonds) */}
        {presPoints.map((p, i) => {
          const cx = getX(p.year);
          const cy = getY(p.participation);
          const s = 5.5; // size of diamond half-diagonal
          const diamondPath = `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;

          return (
            <g
              key={`pres-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <path
                d={diamondPath}
                fill="#a855f7"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
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
      {hoveredPoint && (
        <div
          className="absolute z-10 bg-slate-950 text-white text-[11px] p-2 rounded shadow-lg border border-slate-700 pointer-events-none"
          style={{
            left: `${(getX(hoveredPoint.year) / width) * 100}%`,
            top: "0px",
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold text-sky-400">
            {hoveredPoint.year} ·{" "}
            {hoveredPoint.election === "PRES"
              ? "Presidencial (PRES)"
              : "Diputaciones Federales (DIP_FED)"}
          </div>
          <div>
            Participación:{" "}
            <span className="font-semibold text-white">
              {formatPct(hoveredPoint.participation)}
            </span>
          </div>
          <div className="text-slate-400">
            Lista: {formatInt(hoveredPoint.lista_nominal)}
          </div>
        </div>
      )}

      {/* Complete Legend */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-sky-500 inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-sky-500 inline-block"></span>
          <span>DIP_FED</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 bg-purple-500 inline-block"></span>
          <span>PRES (Presidencial)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-b border-dashed border-emerald-400 inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
          <span>Pronóstico 2027</span>
        </div>
      </div>
    </div>
  );
}
