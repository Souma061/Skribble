import React, { useEffect, useState } from "react";
import { Sparkles, Trophy, ArrowRight } from "lucide-react";
import type { Player } from "../types";

interface RoundEndModalProps {
  isOpen: boolean;
  revealedWord: string;
  reason: string;
  isOwner: boolean;
  players: Player[];
  onNextRound: () => void;
}

export const RoundEndModal: React.FC<RoundEndModalProps> = ({
  isOpen,
  revealedWord,
  reason,
  isOwner,
  players,
  onNextRound,
}) => {
  const [countdown, setCountdown] = useState(6);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(6);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const sortedPlayers = [...players]
    .filter((p) => p.role === "player")
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full border-2 border-[#E9E4F7] pastel-card space-y-6 shadow-2xl text-center">
        {/* Header Icon & Title */}
        <div className="space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-[#EDE9FE] text-[#7C3AED] mx-auto flex items-center justify-center shadow-xs animate-bounce">
            <Sparkles className="w-7 h-7 text-[#7C3AED]" />
          </div>
          <h2 className="text-2xl font-black text-[#2E1065]">
            Round Over!
          </h2>
          <p className="text-xs font-bold text-[#6B7280]">
            {reason}
          </p>
        </div>

        {/* Revealed Secret Word Card */}
        <div className="p-4 rounded-2xl bg-[#FAF5FF] border-2 border-[#DDD6FE] space-y-1 shadow-xs">
          <span className="text-[11px] font-extrabold text-[#7C3AED] uppercase tracking-wider">
            The Secret Word Was
          </span>
          <div className="text-3xl font-black text-[#6D28D9] tracking-wider uppercase font-mono">
            {revealedWord}
          </div>
        </div>

        {/* Mini Scoreboard */}
        <div className="space-y-2 text-left">
          <div className="text-xs font-extrabold text-[#6B7280] flex items-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-[#F59E0B]" />
            Current Standings
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
            {sortedPlayers.map((player, idx) => (
              <div
                key={player.id}
                className="flex items-center justify-between p-2 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-[#7C3AED] w-4">
                    #{idx + 1}
                  </span>
                  <span className="font-bold text-[#374151]">
                    {player.username}
                  </span>
                </div>
                <span className="font-black text-[#6D28D9]">
                  {player.score || 0} pts
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Next Round Action */}
        <div className="pt-2 border-t border-[#F3F4F6]">
          {isOwner ? (
            <button
              onClick={onNextRound}
              className="w-full py-3.5 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-extrabold btn-squishy flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-md"
            >
              <span>Next Turn / Drawer</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="text-xs font-bold text-[#7C3AED] bg-[#EDE9FE] py-2.5 px-4 rounded-2xl animate-pulse">
              Waiting for host to start next turn... ({countdown}s)
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
