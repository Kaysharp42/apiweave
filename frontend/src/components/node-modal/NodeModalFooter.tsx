import { Button } from '../atoms/Button';

interface NodeModalFooterProps {
  onCancel: () => void;
  onSave: () => void;
}

export function NodeModalFooter({ onCancel, onSave }: NodeModalFooterProps) {
  return (
    <div className="mt-5 flex flex-shrink-0 justify-end gap-3 border-t border-border pt-4 dark:border-border-dark">
      <Button onClick={onCancel} variant="outline" className="cursor-pointer">Cancel</Button>
      <Button onClick={onSave} variant="primary" className="cursor-pointer">Save</Button>
    </div>
  );
}
