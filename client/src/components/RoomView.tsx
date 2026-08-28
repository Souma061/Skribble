import React, { useState } from "react";
import {
  Users,
  Eye,
  Crown,
  Copy,
  Check,
  Play,
  LogOut,
  Trash2,
  Sparkles,
  Palette,
} from "lucide-react";
import type { RoomState } from "../types";

interface RoomViewProps {
  room: RoomState;
  currentSocketId: string | null;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onStartGame?: () => void;
}

const PASTEL_CARD_BG = [
  "bg-[#E9E4F7] border-[#DDD6FE] text-[#5B21B6]",
  "bg-[#E2F7ED] border-[#A7F3D0] text-[#065F46]",
  "bg-[#FEF7D6] border-[#FDE68A] text-[#92400E]",
  "bg-[#FCE6EB] border-[#FBCFE8] text-[#9D174D]",
  "bg-[#E3F1FD] border-[#BAE6FD] text-[#075985]",
  "bg-[#FFF0E6] border-[#FED7AA] text-[#9A3412]",
  "bg-[#EDE9FE] border-[#DDD6FE] text-[#6D28D9]",
  "bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]",
];

export const RoomView: React.FC<RoomViewProps> = ({
  room,
  currentSocketId,
  onLeaveRoom,
  onDeleteRoom,
  onStartGame,
}) => {
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isOwner = room.ownerId === currentSocketId;
  const activePlayers = room.players.filter((p) => p.role === "player");
  const spectators = room.players.filter((p) => p.role === "spectator");

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Room Top Banner */}
      <div className="w-full bg-white rounded-3xl p-6 border border-[#E9E4F7] pastel-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#2E1065]">
              {room.name}
            </h2>
            <span className="px-3 py-0.5 rounded-full bg-[#E9E4F7] text-[#6D28D9] text-xs font-bold uppercase tracking-wider">
              Waiting for Host
            </span>
          </div>
          <p className="text-sm font-semibold text-[#6B7280] mt-1">
            Share this Room ID with your friends to join the match!
          </p>
        </div>

        {/* Room Code & Copy */}
        <div className="flex items-center gap-2 bg-[#F3E8FF] border border-[#E9D5FF] px-4 py-2.5 rounded-2xl shadow-xs">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-[#7C3AED] uppercase tracking-wider">
              Room Code
            </span>
            <span className="font-mono text-base font-extrabold text-[#4C1D95]">
              {room.id.slice(0, 13)}...
            </span>
          </div>
          <button
            onClick={handleCopyCode}
            className="p-2 rounded-xl bg-white hover:bg-[#FAF5FF] text-[#6D28D9] border border-[#E9D5FF] transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-green-700">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Capacity & Stat Counters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl p-5 border border-[#E9E4F7] pastel-card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#EDE9FE] text-[#7C3AED] flex items-center justify-center">
              <Palette className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#6B7280]">Active Players</div>
              <div className="text-xl font-extrabold text-[#2E1065]">
                {room.activePlayerCount} <span className="text-xs text-[#9CA3AF]">/ {room.maxActivePlayers} max</span>
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#ECFDF5] text-[#059669] text-xs font-extrabold">
            {room.activePlayerCount > 0 ? "Ready" : "Waiting"}
          </span>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-[#E9E4F7] pastel-card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#E0E7FF] text-[#4F46E5] flex items-center justify-center">
              <Eye className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#6B7280]">Spectators</div>
              <div className="text-xl font-extrabold text-[#2E1065]">
                {room.spectatorCount} <span className="text-xs text-[#9CA3AF]">/ {room.maxSpectators} max</span>
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#F3F4F6] text-[#4B5563] text-xs font-extrabold">
            Viewing
          </span>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-[#E9E4F7] pastel-card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#6B7280]">Total Room Capacity</div>
              <div className="text-xl font-extrabold text-[#2E1065]">
                {room.players.length} <span className="text-xs text-[#9CA3AF]">/ 30 max</span>
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#FEF7D6] text-[#B45309] text-xs font-extrabold">
            Capacity OK
          </span>
        </div>
      </div>

      {/* Players Grid Section */}
      <div className="w-full bg-white rounded-3xl p-6 border border-[#E9E4F7] pastel-card space-y-6">
        {/* Active Players List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#2E1065] flex items-center gap-2">
              <Palette className="w-5 h-5 text-[#7C3AED]" />
              Active Players ({activePlayers.length}/15)
            </h3>
            <span className="text-xs font-semibold text-[#6B7280]">
              Eligible to draw & earn points
            </span>
          </div>

          {activePlayers.length === 0 ? (
            <div className="p-8 text-center bg-[#F9FAFB] rounded-2xl border border-dashed border-[#E5E7EB] text-sm text-[#6B7280] font-semibold">
              No active players yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {activePlayers.map((player, idx) => {
                const isThisPlayerOwner = player.id === room.ownerId;
                const isCurrent = player.id === currentSocketId;
                const cardStyle = PASTEL_CARD_BG[idx % PASTEL_CARD_BG.length];

                return (
                  <div
                    key={player.id}
                    className={`p-3.5 rounded-2xl border-2 ${cardStyle} flex items-center justify-between gap-2 shadow-xs transition-transform hover:scale-[1.02]`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/80 border border-white flex items-center justify-center text-lg font-bold shadow-xs">
                        {isThisPlayerOwner ? "👑" : "🎨"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold truncate flex items-center gap-1">
                          {player.username}
                          {isCurrent && (
                            <span className="text-[10px] bg-black/10 px-1.5 py-0.2 rounded-md font-bold">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold opacity-75">
                          {isThisPlayerOwner ? "Room Host" : "Player"}
                        </div>
                      </div>
                    </div>

                    {isThisPlayerOwner && (
                      <Crown className="w-4 h-4 text-[#F59E0B] shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Spectators List */}
        {spectators.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-[#F3F4F6]">
            <h3 className="text-base font-extrabold text-[#2E1065] flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#4F46E5]" />
              Spectators ({spectators.length}/15)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {spectators.map((spec) => {
                const isCurrent = spec.id === currentSocketId;
                return (
                  <div
                    key={spec.id}
                    className="p-3 rounded-2xl bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-between text-xs font-bold text-[#4B5563]"
                  >
                    <span className="truncate">
                      👁️ {spec.username} {isCurrent && "(You)"}
                    </span>
                    <span className="text-[10px] bg-[#E0E7FF] text-[#4338CA] px-2 py-0.5 rounded-full font-bold">
                      Spectator
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action Controls Bar */}
        <div className="pt-6 border-t border-[#F3F4F6] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onLeaveRoom}
              className="px-5 py-3 rounded-2xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] text-sm font-extrabold flex items-center gap-2 btn-squishy cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Leave Room
            </button>

            {isOwner && (
              <>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onDeleteRoom}
                      className="px-4 py-3 rounded-2xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-extrabold flex items-center gap-1.5 btn-squishy cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 py-3 rounded-2xl bg-[#F3F4F6] text-[#4B5563] text-xs font-bold hover:bg-[#E5E7EB] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-3 rounded-2xl bg-[#FEE2E2] hover:bg-[#FECACA] text-[#991B1B] text-sm font-bold flex items-center gap-2 btn-squishy cursor-pointer transition-colors"
                    title="Delete Room for all players"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Room
                  </button>
                )}
              </>
            )}
          </div>

          {/* Host Start Game Button */}
          {isOwner ? (
            <button
              onClick={onStartGame}
              disabled={activePlayers.length === 0}
              className="px-8 py-3.5 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-white text-base font-extrabold shadow-md btn-squishy flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Play className="w-5 h-5 fill-white" />
              Start Game Now
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-[#6D28D9] bg-[#EDE9FE] px-4 py-2 rounded-2xl animate-pulse">
              <Sparkles className="w-4 h-4" />
              Waiting for host to start...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
