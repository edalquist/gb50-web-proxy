import React, { useState } from 'react';
import { X, AlertTriangle, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { SeasonReconcileStatus } from '../types';
import { executeSeasonReconciliation } from '../api';

interface SeasonReconcileModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: SeasonReconcileStatus | null;
  onReconciled: () => void;
}

export const SeasonReconcileModal: React.FC<SeasonReconcileModalProps> = ({
  isOpen,
  onClose,
  status,
  onReconciled,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !status) return null;

  const handleAction = async (action: 'pull_from_controller' | 'push_to_controller') => {
    setLoading(true);
    setError(null);
    try {
      await executeSeasonReconciliation(action);
      onReconciled();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reconcile season dates.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Reconcile Season Dates</h3>
              <p className="text-xs text-slate-400">Synchronize database configuration with controller hardware</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs text-slate-300">
            A mismatch was detected between the seasonal schedule dates configured in the application and the active EEPROM dates stored on the GB-50 controller:
          </p>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs divide-y divide-slate-800/60">
            {status.mismatches && status.mismatches.length > 0 ? (
              status.mismatches.map((m, idx) => (
                <div key={idx} className={idx > 0 ? 'pt-2' : ''}>
                  <strong className="text-slate-200 block">Season {m.season_id} ({m.name || 'Unassigned'})</strong>
                  <div className="grid grid-cols-2 gap-2 mt-1 text-[11px]">
                    <div className="text-slate-400">
                      <span>Database: </span>
                      <span className="font-mono text-slate-200">
                        {m.db?.start_month}/{m.db?.start_day} – {m.db?.end_month}/{m.db?.end_day}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      <span>Controller: </span>
                      <span className="font-mono text-blue-300 font-semibold">
                        {m.controller?.start_month}/{m.controller?.start_day} – {m.controller?.end_month}/{m.controller?.end_day}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-xs">Dates are reconciled.</p>
            )}
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <button
            onClick={() => handleAction('pull_from_controller')}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/30"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDown className="w-4 h-4" />}
            Use Controller Hardware Dates (Recommended)
          </button>
          <button
            onClick={() => handleAction('push_to_controller')}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            Overwrite Controller with Database Dates
          </button>
        </div>
      </div>
    </div>
  );
};
