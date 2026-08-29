import React, { useState } from "react";
import { Sparkles, Pencil } from "lucide-react";

interface WordModalProps {
  isOpen: boolean;
  suggestions: string[];
  onSubmitWord: (word: string, hint?: string) => void;
}

export const WordModal: React.FC<WordModalProps> = ({
  isOpen,
  suggestions,
  onSubmitWord,
}) => {
  const [customWord, setCustomWord] = useState("");
  const [customHint, setCustomHint] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customWord.trim()) return;
    onSubmitWord(customWord.trim(), customHint.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full border-2 border-[#E9E4F7] pastel-card space-y-6 shadow-2xl">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#EDE9FE] text-[#7C3AED] mx-auto flex items-center justify-center shadow-xs">
            <Pencil className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-extrabold text-[#2E1065]">
            Choose Your Word!
          </h2>
          <p className="text-xs font-semibold text-[#6B7280]">
            Pick a quick suggestion or type your own custom secret word.
          </p>
        </div>

        {/* Quick 1-Click Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#6B7280] flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
              Quick Suggestions
            </label>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => onSubmitWord(sug, "")}
                  className="px-3.5 py-2 rounded-xl bg-[#F3E8FF] hover:bg-[#E9D5FF] text-[#6B21A8] text-xs font-extrabold btn-squishy cursor-pointer transition-all"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom Word Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-[#F3F4F6]">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#374151]">
              Custom Secret Word *
            </label>
            <input
              type="text"
              required
              maxLength={25}
              value={customWord}
              onChange={(e) => setCustomWord(e.target.value)}
              placeholder="e.g. Sunflower, Pizza, Rocket"
              className="w-full px-4 py-3 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-[#1F2937] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#374151]">
              Optional Custom Hint
            </label>
            <input
              type="text"
              maxLength={40}
              value={customHint}
              onChange={(e) => setCustomHint(e.target.value)}
              placeholder="e.g. A yellow summer flower"
              className="w-full px-4 py-2.5 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-[#1F2937] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
          </div>

          <button
            type="submit"
            disabled={!customWord.trim()}
            className="w-full py-3.5 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#D1D5DB] text-white text-sm font-extrabold btn-squishy cursor-pointer transition-colors shadow-md"
          >
            Start Drawing Now!
          </button>
        </form>
      </div>
    </div>
  );
};
