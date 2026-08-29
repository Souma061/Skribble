import React from "react";
import { Sparkles } from "lucide-react";

export const ThemeToggle: React.FC = () => {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#EDE9FE] text-[#7C3AED] text-xs font-bold shadow-xs select-none">
      <Sparkles className="w-3.5 h-3.5" />
      <span>Pastel Mode</span>
    </div>
  );
};
