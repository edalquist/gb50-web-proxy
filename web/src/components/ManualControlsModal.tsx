import React from 'react';
import { Power, AlertTriangle, X } from 'lucide-react';

interface ManualControlsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  action: 'all_on' | 'all_off';
  totalSpaces: number;
  loading: boolean;
}

export const ManualControlsModal: React.FC<ManualControlsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  action,
  totalSpaces,
  loading,
}) => {
  if (!isOpen) return null;

  const isAllOn = action === 'all_on';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="manual-control-title"
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${
              isAllOn 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}>
              <Power className="w-5 h-5" />
            </div>
            <div>
              <h2 id="manual-control-title" className="text-lg font-bold text-slate-100">
                {isAllOn ? `Turn ON All ${totalSpaces} Spaces?` : `Turn OFF All ${totalSpaces} Spaces?`}
              </h2>
              <p className="text-xs text-slate-400">Immediate manual building override</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Close modal"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex items-start gap-2.5 text-xs text-slate-300">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p>
            {isAllOn
              ? `This will immediately power ON all ${totalSpaces} configured equipment units to 70°F (Auto mode). Published recurring schedules will remain unchanged.`
              : `This will immediately power OFF all ${totalSpaces} configured units. Published recurring schedules will remain unchanged.`}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 border border-slate-700 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition flex items-center gap-1.5 ${
              isAllOn
                ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50'
                : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/50'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            {loading ? 'Executing...' : isAllOn ? `Confirm All ON` : `Confirm All OFF`}
          </button>
        </div>
      </div>
    </div>
  );
};
