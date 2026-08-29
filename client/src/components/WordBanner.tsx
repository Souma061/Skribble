import React from "react";
import { Timer, Lightbulb, Eye, Pencil } from "lucide-react";

interface WordBannerProps {
  isDrawer: boolean;
  word?: string;
  blanks?: string;
  letterCount?: number;
  hint?: string;
  timeLeft: number;
}

export const WordBanner: React.FC<WordBannerProps> = ({
  isDrawer,
  word,
  blanks,
  letterCount,
  hint,
  timeLeft,
}) => {
  return (
    <div className="w-full bg-white rounded-3xl p-4 border border-[#E9E4F7] pastel-card flex flex-wrap items-center justify-between gap-4 shadow-sm animate-fade-in">
      {/* Timer Display */}
      <div className="flex items-center gap-2 bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] px-4 py-2 rounded-2xl shadow-xs">
        <Timer className={`w-5 h-5 ${timeLeft <= 15 ? "text-red-600 animate-bounce" : ""}`} />
        <span className="text-lg font-black font-mono">
          {timeLeft}s
        </span>
      </div>

      {/* Word / Blanks Display */}
      <div className="flex flex-col items-center justify-center text-center">
        {isDrawer ? (
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-[#7C3AED]" />
            <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
              Drawing:
            </span>
            <span className="text-xl md:text-2xl font-black text-[#6D28D9] tracking-wider uppercase">
              {word || "Your Word"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <Eye className="w-4 h-4 text-[#4F46E5]" />
            <span className="text-xl md:text-2xl font-black text-[#2E1065] tracking-[0.25em] font-mono">
              {blanks || "_ _ _ _"}
            </span>
            {letterCount && (
              <span className="text-xs font-bold text-[#9CA3AF]">
                ({letterCount})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hint Badge */}
      <div className="flex items-center gap-1.5 bg-[#EDE9FE] border border-[#DDD6FE] text-[#6D28D9] px-3.5 py-2 rounded-2xl text-xs font-bold shadow-xs">
        <Lightbulb className="w-4 h-4 text-[#F59E0B]" />
        <span>{hint ? `Hint: ${hint}` : "Hint unlocks with time"}</span>
      </div>
    </div>
  );
};
