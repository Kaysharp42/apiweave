import { MainHeader } from '../components/layout/MainHeader';
import { ApprovedDomainManager } from '../components/auth/ApprovedDomainManager';
import { Globe } from 'lucide-react';

export default function AdminDomainsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-surface dark:bg-surface-dark font-sans text-text-primary dark:text-text-primary-dark">
      <MainHeader />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">Approved Domains</h1>
          </div>
          <p className="text-text-secondary dark:text-text-secondary-dark mb-8">
            Manage email domains that are automatically approved to sign up and join the workspace.
            Users signing up with an email from an approved domain will be granted the default 'viewer' role.
          </p>
          <ApprovedDomainManager />
        </div>
      </main>
    </div>
  );
}
