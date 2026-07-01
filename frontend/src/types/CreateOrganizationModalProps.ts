import type { Organization } from "./Organization";

export interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (organization: Organization) => Promise<void> | void;
}
