import React from 'react';

const WorkflowSettingsPanel = ({ settings = {}, onSettingChange }) => {
  const handleContinueOnFailChange = (value) => {
    onSettingChange({
      ...settings,
      continueOnFail: value,
    });
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 h-full flex flex-col border-t dark:border-gray-700">
      <div className="p-3 space-y-4">
        {/* Continue on Fail Option */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <span>⚙️ Execution Settings</span>
          </label>
          
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded space-y-3">
            {/* Continue on Fail Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.continueOnFail || false}
                    onChange={(e) => handleContinueOnFailChange(e.target.checked)}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                  Continue on Fail
                </label>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {settings.continueOnFail ? (
                    <>✅ Workflow continues even if an API fails</>
                  ) : (
                    <>⛔ Workflow stops at the first API failure</>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Info Section */}
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-[10px] text-blue-700 dark:text-blue-300 space-y-1">
          <p><strong>ℹ️ About Continue on Fail:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>When <strong>disabled (default)</strong>: Stops workflow at first failed API call</li>
            <li>When <strong>enabled</strong>: Continues to next API even if current one fails</li>
            <li>Useful for testing error scenarios or conditional workflows</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default WorkflowSettingsPanel;
