import { useState, useRef, type ChangeEvent } from 'react';
import { Input } from '../atoms/Input';
import { FormField } from '../molecules/FormField';
import { PanelTabs } from '../molecules/PanelTabs';
import type { DelayConfigPanelProps } from '../../types/DelayConfigPanelProps';

export function DelayConfigPanel({ initialConfig, workingDataRef }: DelayConfigPanelProps) {
  const [activeTab, setActiveTab] = useState('parameters');

  const durationRef = useRef(initialConfig.duration || 1000);

  const updateRef = () => {
    const newConfig = {
      duration: durationRef.current,
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelTabs
        tabs={[
          { key: 'parameters', label: 'Parameters' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 overflow-y-auto p-4">
        <FormField
          label="Duration"
          hint={`${(durationRef.current || 1000) / 1000} second${(durationRef.current || 1000) !== 1000 ? 's' : ''}`}
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              defaultValue={initialConfig.duration || 1000}
              onBlur={() => updateRef()}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                durationRef.current = parseInt(e.target.value) || 1000;
              }}
              className="w-32"
              min="100"
              step="100"
            />
            <span className="text-sm text-text-secondary dark:text-text-secondary-dark">milliseconds</span>
          </div>
        </FormField>
      </div>
    </div>
  );
}