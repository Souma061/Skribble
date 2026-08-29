import React from "react";
import { Crown, RotateCcw, Sparkles } from "lucide-react";
import type { Player } from "../types";

interface GameOverModalProps {
  isOpen: boolean;
  players: Player[];
  onPlayAgain: () => void;
  onLeaveRoom: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  isOpen,
  players,
  onPlayAgain,
  onLeaveRoom,
}) => {
  if (!isOpen) return null;

  const sortedPlayers = [...players]
    .filter((p) => p.role === "player")
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const winner = sortedPlayers[0];
  const second = sortedPlayers[1];
  const third = sortedPlayers[2];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full border-2 border-[#E9E4F7] pastel-card space-y-6 shadow-2xl text-center">
        {/* Header */}
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FEF3C7] text-[#B45309] text-xs font-black uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            Match Completed
          </div>
          <h2 className="text-3xl font-black text-[#2E1065]">
            Game Over! 🏆
          </h2>
          <p className="text-xs font-bold text-[#6B7280]">
            Awesome match everyone! Here is the final leaderboard.
          </p>
        </div>

        {/* 3-Player Pastel Podium */}
        <div className="flex items-end justify-center gap-3 pt-4 pb-2">
          {/* 2nd Place */}
          {second && (
            <div className="flex-1 flex flex-col items-center">
              <span className="text-lg">🥈</span>
              <span className="text-xs font-extrabold text-[#374151] truncate max-w-[80px]">
                {second.username}
              </span>
              <span className="text-[11px] font-black text-[#6B7280]">
                {second.score || 0} pts
              </span>
              <div className="w-full h-20 bg-[#E5E7EB] rounded-t-2xl mt-2 flex items-center justify-center font-black text-gray-500 text-sm">
                2
              </div>
            </div>
          )}

          {/* 1st Place (Winner) */}
          {winner && (
            <div className="flex-1 flex flex-col items-center">
              <Crown className="w-6 h-6 text-[#F59E0B] animate-bounce" />
              <span className="text-sm font-black text-[#6D28D9] truncate max-w-[100px]">
                {winner.username}
              </span>
              <span className="text-xs font-black text-[#7C3AED]">
                {winner.score || 0} pts
              </span>
              <div className="w-full h-28 bg-[#FEF3C7] border-2 border-[#FDE68A] rounded-t-2xl mt-2 flex items-center justify-center font-black text-[#B45309] text-lg shadow-sm">
                🥇 1
              </div>
            </div>
          )}

          {/* 3rd Place */}
          {third && (
            <div className="flex-1 flex flex-col items-center">
              <span className="text-lg">🥉</span>
              <span className="text-xs font-extrabold text-[#374151] truncate max-w-[80px]">
                {third.username}
              </span>
              <span className="text-[11px] font-black text-[#6B7280]">
                {third.score || 0} pts
              </span>
              <div className="w-full h-14 bg-[#FED7AA] rounded-t-2xl mt-2 flex items-center justify-center font-black text-[#C2410C] text-xs">
                3
              </div>
            </div>
          )}
        </div>

        {/* Full Roster Standings */}
        <div className="max-h-36 overflow-y-auto space-y-1.5 text-left pr-1">
          {sortedPlayers.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-2.5 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-black text-[#7C3AED] w-5">#{idx + 1}</span>
                <span className="font-bold text-[#1F2937]">{p.username}</span>
              </div>
              <span className="font-black text-[#6D28D9]">{p.score || 0} pts</span>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-3 border-t border-[#F3F4F6]">
          <button
            onClick={onLeaveRoom}
            className="flex-1 py-3 rounded-2xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] text-xs font-extrabold btn-squishy cursor-pointer transition-colors"
          >
            Exit to Lobby
          </button>
          <button
            onClick={onPlayAgain}
            className="flex-1 py-3 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-extrabold btn-squishy flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-md"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Play Again
          </button>
        </div>
      </div>
    </div>
  );
};
